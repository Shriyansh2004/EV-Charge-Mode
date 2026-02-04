/* =========================
   IMPORTS
   ========================= */
const express = require("express");
const cors = require("cors");
const { v4: uuid } = require("uuid");

/* =========================
   IN-MEMORY STORES (Replace with DB for production)
   ========================= */
let otpStore = {};         // bookingId → otp
let activeSessions = {};  // bookingId → verified
let chargers = [];
let bookings = [];
let sessionStartTimes = {}; // bookingId → actual start timestamp
let sessionIds = {}; // bookingId → sessionId (from CMS)
let lateArrivalTimers = {}; // bookingId → { startTime, expiryTime }
let lateFeeIntervals = {}; // bookingId → intervalId for late fee accumulation

/* =========================
   UTILITY FUNCTIONS
   ========================= */
function parseDateTime(date, time) {
  let year, month, day;
  if (date.includes("/")) {
    [day, month, year] = date.split("/");
  } else {
    [year, month, day] = date.split("-");
  }

  let hour = 0, minute = 0;
  if (time.toLowerCase().includes("am") || time.toLowerCase().includes("pm")) {
    let t = time.toLowerCase();
    hour = parseInt(t);
    if (t.includes("pm") && hour !== 12) hour += 12;
    if (t.includes("am") && hour === 12) hour = 0;
  } else {
    [hour, minute] = time.split(":").map(Number);
  }

  return new Date(year, month - 1, day, hour, minute, 0);
}

function scheduleOtp(booking) {
  const { bookingId, start_Time, date } = booking;
  const slotStart = parseDateTime(date, start_Time);
  const otpTime = new Date(slotStart.getTime() - 15 * 60 * 1000);
  const delay = otpTime - new Date();

  if (delay <= 0) return;

  setTimeout(() => {
    const otp = Math.floor(1000 + Math.random() * 9000);
    otpStore[bookingId] = otp;
    console.log("🔐 AUTO OTP GENERATED:", bookingId, otp);
  }, delay);
}

// Auto-close no-show bookings
function scheduleNoShowCheck(booking) {
  const { bookingId, start_Time, date, slotDuration } = booking;
  const slotStart = parseDateTime(date, start_Time);
  const slotEnd = new Date(slotStart.getTime() + parseFloat(slotDuration.match(/(\d+(?:\.\d+)?)/)?.[1] || 0) * 60 * 60 * 1000);

  // Check after scheduled end time + 5 minutes grace period
  const checkTime = new Date(slotEnd.getTime() + 5 * 60 * 1000);
  const delay = checkTime - new Date();

  if (delay <= 0) return;

  setTimeout(async () => {
    // Check if session was never started
    const booking = bookings.find(b => b.bookingId === bookingId);
    if (!booking || booking.status === "CANCELLED" || booking.status === "CANCELLED_IN_PROGRESS") {
      return; // Already cancelled
    }

    // Check if session was started
    if (!sessionStartTimes[bookingId] && !activeSessions[bookingId]) {
      // No-show detected - auto close
      const charger = chargers.find(c => c.chargerId === booking.chargerId);
      if (charger) {
        charger.status = "AVAILABLE";
      }

      booking.status = "NO_SHOW";

      // Unblock charger in CMS
      try {
        await fetch("http://localhost:3001/api/charger/unblock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chargerId: booking.chargerId,
            bookingId
          })
        });
      } catch (e) {
        console.error("Error unblocking charger for no-show:", e);
      }

      console.log(`❌ NO-SHOW DETECTED: Booking ${bookingId} auto-closed`);
    }
  }, delay);
}

function scheduleLateArrivalTimer(booking) {
  const { bookingId } = booking;

  // Start timer immediately after booking (50 seconds for EV driver to arrive and start session)
  const startTime = Date.now();
  const expiryTime = startTime + 50 * 1000;
  lateArrivalTimers[bookingId] = { startTime, expiryTime };
  console.log(`⏰ LATE ARRIVAL TIMER STARTED for booking ${bookingId}`);

  // After 50 seconds, mark as late arrival if session not started and start late fee timer
  setTimeout(() => {
    if (lateArrivalTimers[bookingId] && !sessionStartTimes[bookingId] && !activeSessions[bookingId]) {
      const booking = bookings.find(b => b.bookingId === bookingId);
      if (booking && booking.status !== "CANCELLED" && booking.status !== "CANCELLED_IN_PROGRESS") {
        booking.lateArrival = true;
        booking.lateArrivalTime = Date.now(); // Store when late arrival was detected
        booking.lateArrivalFee = 0; // Initialize late arrival fee
        console.log(`🚨 LATE ARRIVAL DETECTED for booking ${bookingId}`);

        // Start late fee accumulation timer (5 rupees per minute)
        console.log(`💰 LATE FEE TIMER STARTED for booking ${bookingId}`);
        lateFeeIntervals[bookingId] = setInterval(() => {
          const currentBooking = bookings.find(b => b.bookingId === bookingId);
          if (currentBooking && currentBooking.lateArrival && !sessionStartTimes[bookingId] && !activeSessions[bookingId]) {
            currentBooking.lateArrivalFee += 5;
            console.log(`💰 LATE FEE ACCUMULATED for booking ${bookingId}: ₹${currentBooking.lateArrivalFee}`);
          } else {
            // Stop the timer if session started or booking cancelled
            if (lateFeeIntervals[bookingId]) {
              clearInterval(lateFeeIntervals[bookingId]);
              delete lateFeeIntervals[bookingId];
              console.log(`💰 LATE FEE TIMER STOPPED for booking ${bookingId}`);
            }
          }
        }, 60 * 1000); // Every minute
      }
    }
  // Clear the timer regardless
  delete lateArrivalTimers[bookingId];
  console.log(`⏰ LATE ARRIVAL TIMER ENDED for booking ${bookingId}`);
  }, 50 * 1000); // 50 seconds timer
}

function canRequestOtp(start_Time, date) {
  const now = new Date();
  const slotStart = parseDateTime(date, start_Time);
  const otpAllowedTime = new Date(slotStart.getTime() - 15 * 60 * 1000);
  return now >= otpAllowedTime;
}

function isPastDateTime(date, time) {
  const now = new Date();
  const slotDateTime = parseDateTime(date, time);
  return slotDateTime < now;
}

/* =========================
   COST CALCULATION FUNCTIONS
   ========================= */

// Determine if charger is AC or DC based on connector type
function isDCCharger(connector) {
  const dcConnectors = ["CCS2", "CHAdeMO", "GB/T", "Bharat DC001"];
  return dcConnectors.some(dc => connector.includes(dc));
}

/**
 * Calculate cost for a completed session
 * 
 * Formula:
 * Actual Cost = (Energy / Efficiency) × Base Tariff × (1 + Demand Surcharge)
 *              + Booking Fee
 *              + Idle Fee
 *              + Late Arrival Fee
 *              ± Early Cancellation Fee
 *              + GST
 * 
 * No-Show Case: Actual Cost = No Show Fee
 * 
 * Early Cancellation Fee = ((Booked duration - Actual duration in minutes) / 60) × ₹25
 * - If driver cancels → ADD fee
 * - If host cancels → SUBTRACT fee
 */
function calculateCost(booking, charger, timerData, actualStartTime, actualEndTime, cancelledBy = null) {
  // Constants (as per specification)
  const BASE_TARIFF = 15; // ₹/kWh
  const BOOKING_FEE_PER_HOUR = 10; // ₹/hour
  const DEMAND_SURCHARGE_FACTOR = 0.0;
  const IDLE_FEE_PER_MIN = 5; // ₹/min
  const IDLE_GRACE_PERIOD_MIN = 5; // minutes
  const LATE_ARRIVAL_FEE_PER_MIN = 5; // ₹/min
  const LATE_GRACE_PERIOD_MIN = 10; // minutes
  const EARLY_CANCELLATION_FEE_PER_HOUR = 25; // ₹/hour
  const NO_SHOW_FEE = 0; // ₹
  const GST_RATE = 0.18; // 18%

  // Determine efficiency based on charger type
  const efficiency = isDCCharger(charger.connector) ? 0.95 : 0.9;

  // Parse booked duration
  const bookedDurationMatch = booking.slotDuration.match(/(\d+(?:\.\d+)?)\s*Hours?/i);
  const bookedDurationHours = bookedDurationMatch ? parseFloat(bookedDurationMatch[1]) : 0;
  const bookedDurationMinutes = bookedDurationHours * 60;

  // Calculate actual duration (handle both string and number from CMS)
  const actualDurationSeconds = timerData.durationSeconds ? parseFloat(timerData.durationSeconds) : 0;
  const actualDurationMinutes = actualDurationSeconds / 60;
  const actualDurationHours = actualDurationMinutes / 60;

  // Energy consumed for this session
  // Note: CMS returns totalEnergy (accumulated), but for cost calculation we need session energy
  // For now, we'll use the energy from timerData. In production, CMS should return sessionEnergy separately
  const energyConsumed = timerData.sessionEnergy ? parseFloat(timerData.sessionEnergy) : 
                        (timerData.totalEnergy ? parseFloat(timerData.totalEnergy) : 0);

  // No show scenario
  if (energyConsumed === 0 && actualDurationMinutes === 0) {
    return {
      baseCost: 0,
      energyCost: 0,
      bookingFee: 0,
      idleFee: 0,
      lateArrivalFee: 0,
      earlyCancellationFee: 0,
      noShowFee: NO_SHOW_FEE,
      subtotal: NO_SHOW_FEE,
      gst: NO_SHOW_FEE * GST_RATE,
      total: NO_SHOW_FEE * (1 + GST_RATE),
      energyDelivered: 0,
      breakdown: {
        energyConsumed: 0,
        efficiency: efficiency,
        bookedDurationHours: bookedDurationHours,
        actualDurationHours: actualDurationHours,
        isNoShow: true
      }
    };
  }

  // Calculate energy cost
  const energyCost = (energyConsumed / efficiency) * BASE_TARIFF * (1 + DEMAND_SURCHARGE_FACTOR);

  // Calculate booking fee
  const bookingFee = bookedDurationHours * BOOKING_FEE_PER_HOUR;

  // Calculate late arrival fee - use accumulated fee from timer if available
  let lateArrivalFee = 0;
  let lateArrivalMinutes = 0;
  if (booking.lateArrivalFee && booking.lateArrivalFee > 0) {
    // Use the accumulated late arrival fee from the timer
    lateArrivalFee = booking.lateArrivalFee;
    lateArrivalMinutes = lateArrivalFee / LATE_ARRIVAL_FEE_PER_MIN;
  } else if (actualStartTime) {
    // Fallback: calculate based on scheduled vs actual start time
    const scheduledStartTime = parseDateTime(booking.date, booking.start_Time);
    lateArrivalMinutes = Math.max(0, (actualStartTime - scheduledStartTime) / (1000 * 60) - LATE_GRACE_PERIOD_MIN);
    lateArrivalFee = lateArrivalMinutes * LATE_ARRIVAL_FEE_PER_MIN;
  }

  // Calculate idle fee (time after session ends but before grace period)
  let idleFee = 0;
  let idleMinutes = 0;
  if (actualEndTime && actualStartTime) {
    const scheduledStartTime = parseDateTime(booking.date, booking.start_Time);
    // Calculate scheduled end time
    const scheduledEndTime = new Date(scheduledStartTime.getTime() + bookedDurationHours * 60 * 60 * 1000);
    idleMinutes = Math.max(0, (actualEndTime - scheduledEndTime) / (1000 * 60) - IDLE_GRACE_PERIOD_MIN);
    idleFee = idleMinutes * IDLE_FEE_PER_MIN;
  }

  // Calculate early cancellation fee
  let earlyCancellationFee = 0;
  if (cancelledBy) {
    const unusedMinutes = Math.max(0, bookedDurationMinutes - actualDurationMinutes);
    const unusedHours = unusedMinutes / 60;
    earlyCancellationFee = unusedHours * EARLY_CANCELLATION_FEE_PER_HOUR;
    
    // If host cancelled, subtract; if driver cancelled, add
    if (cancelledBy === "HOST") {
      earlyCancellationFee = -earlyCancellationFee;
    }
  }

  // Calculate subtotal
  const subtotal = energyCost + bookingFee + idleFee + lateArrivalFee + earlyCancellationFee;

  // Calculate GST
  const gst = subtotal * GST_RATE;

  // Calculate total
  const total = subtotal + gst;

  return {
    baseCost: energyCost,
    energyCost: energyCost,
    bookingFee: bookingFee,
    idleFee: idleFee,
    lateArrivalFee: lateArrivalFee,
    earlyCancellationFee: earlyCancellationFee,
    noShowFee: 0,
    subtotal: subtotal,
    gst: gst,
    total: total,
    energyDelivered: energyConsumed,
    breakdown: {
      energyConsumed: energyConsumed,
      efficiency: efficiency,
      bookedDurationHours: bookedDurationHours,
      actualDurationHours: actualDurationHours,
      lateArrivalMinutes: lateArrivalMinutes,
      idleMinutes: idleMinutes,
      isNoShow: false
    }
  };
}

/* =========================
   FETCH SETUP
   ========================= */
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

/* =========================
   EXPRESS APP SETUP
   ========================= */
const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   HOST MODE – ADD CHARGER
   ========================= */
app.post("/api/host", (req, res) => {
  const { date, start_Time } = req.body;

  if (isPastDateTime(date, start_Time)) {
    return res.status(400).json({
      message: "❌ You cannot host a charger for a past date or time"
    });
  }

  const charger = {
    chargerId: "CHG-" + uuid().slice(0, 8),
    status: "AVAILABLE",
    totalEnergy: 0,
    ...req.body
  };

  chargers.push(charger);

  res.json({
    message: "✅ Charger hosted successfully",
    charger
  });
});

/* =========================
   GET CHARGERS
   ========================= */
app.get("/api/chargers", (req, res) => {
  res.json(chargers);
});

/* =========================
   GET BOOKINGS BY CHARGER ID
   ========================= */
app.get("/api/bookings/:chargerId", (req, res) => {
  const { chargerId } = req.params;
  const chargerBookings = bookings.filter(b => b.chargerId === chargerId);
  res.json(chargerBookings);
});

/* =========================
   GET SINGLE BOOKING (for cost & payment status)
   ========================= */
app.get("/api/booking/:bookingId", (req, res) => {
  const { bookingId } = req.params;
  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  res.json(booking);
});

/* =========================
   GET BOOKING TIMER STATUS
   ========================= */
app.get("/api/booking/timer/:bookingId", (req, res) => {
  const { bookingId } = req.params;
  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  const timerData = lateArrivalTimers[bookingId];
  if (!timerData) {
    return res.json({
      bookingId,
      hasTimer: false,
      lateArrival: booking.lateArrival || false
    });
  }

  const elapsedSeconds = (Date.now() - timerData.startTime) / 1000;
  const remainingSeconds = Math.max(0, 50 - elapsedSeconds);

  res.json({
    bookingId,
    hasTimer: true,
    remainingSeconds: Math.floor(remainingSeconds),
    elapsedSeconds: Math.floor(elapsedSeconds),
    lateArrival: booking.lateArrival || false
  });
});

/* =========================
   MARK BOOKING AS PAID (driver paid)
   ========================= */
app.post("/api/booking/:bookingId/pay", (req, res) => {
  const { bookingId } = req.params;
  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  if (!booking.sessionCost) {
    return res.status(400).json({ message: "No session cost to pay for this booking" });
  }
  booking.paymentStatus = "paid";
  res.json({ message: "Payment recorded", bookingId, paymentStatus: "paid" });
});

/* =========================
   CREATE BOOKING (Standard endpoint)
   ========================= */
app.post("/api/booking/create", async (req, res) => {
  const { chargerId } = req.body;

  const charger = chargers.find(c => c.chargerId === chargerId);
  if (!charger) return res.status(404).json({ message: "Charger not found" });

  if (isPastDateTime(charger.date, charger.start_Time)) {
    return res.status(400).json({ message: "❌ Cannot book past slot" });
  }

  if (charger.status === "BOOKED") {
    return res.status(400).json({ message: "Already booked" });
  }

  const bookingId = "BOOK-" + uuid().slice(0, 8);

  await fetch("http://localhost:3001/api/charger/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId,
      bookingId,
      start_Time: charger.start_Time,
      duration: charger.slotDuration + " Hours"
    })
  });

  charger.status = "BOOKED";

  const booking = {
    bookingId,
    chargerId,
    date: charger.date,
    start_Time: charger.start_Time,
    slotDuration: charger.slotDuration + " Hours",
    status: "BOOKING CONFIRMED"
  };

  bookings.push(booking);
  scheduleOtp(booking);
  scheduleNoShowCheck(booking);
  scheduleLateArrivalTimer(booking);

  res.json({
    message: "Booking created successfully",
    booking
  });
});

/* =========================
   BOOK CHARGER (Legacy endpoint - kept for compatibility)
   ========================= */
app.post("/api/book", async (req, res) => {
  const { chargerId, duration } = req.body;

  const charger = chargers.find(c => c.chargerId === chargerId);
  if (!charger) return res.status(404).json({ message: "Charger not found" });

  if (isPastDateTime(charger.date, charger.start_Time)) {
    return res.status(400).json({ message: "❌ Cannot book past slot" });
  }

  if (charger.status === "BOOKED") {
    return res.status(400).json({ message: "Already booked" });
  }

  const bookingId = "BOOK-" + uuid().slice(0, 8);

  // Convert duration to hours for CMS
  let durationInHours;
  if (duration === "2MIN") {
    durationInHours = 2 / 60; // 2 minutes = 2/60 hours
  } else if (duration === "30MIN") {
    durationInHours = 0.5;
  } else if (duration === "45MIN") {
    durationInHours = 0.75;
  } else if (duration === "1HR") {
    durationInHours = 1;
  } else if (duration === "1.5HR") {
    durationInHours = 1.5;
  } else if (duration === "2HR") {
    durationInHours = 2;
  } else {
    return res.status(400).json({ message: "Invalid duration" });
  }

  await fetch("http://localhost:3001/api/charger/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId,
      bookingId,
      start_Time: charger.start_Time,
      duration: durationInHours + " Hours"
    })
  });

  charger.status = "BOOKED";

  const booking = {
    bookingId,
    chargerId,
    date: charger.date,
    start_Time: charger.start_Time,
    slotDuration: durationInHours + " Hours",
    status: "BOOKING CONFIRMED"
  };

  bookings.push(booking);
  scheduleOtp(booking);
  scheduleNoShowCheck(booking);
  scheduleLateArrivalTimer(booking);

  res.json({
    message: "Booking successful",
    booking
  });
});

/* =========================
   REQUEST OTP
   ========================= */
app.post("/api/request-otp", (req, res) => {
  const { bookingId } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (!canRequestOtp(booking.start_Time, booking.date)) {
    return res.json({
      message: "⏳ OTP will be sent automatically 15 minutes before session start"
    });
  }

  const otp = otpStore[bookingId];
  if (!otp) {
    // Generate OTP if not already generated
    const newOtp = Math.floor(1000 + Math.random() * 9000);
    otpStore[bookingId] = newOtp;
    console.log("🔐 OTP GENERATED ON REQUEST:", bookingId, newOtp);
    return res.json({
      message: "OTP generated successfully",
      bookingId,
      otp: newOtp
    });
  }

  res.json({
    message: "OTP already generated",
    bookingId,
    otp
  });
});

/* =========================
   VERIFY OTP
   ========================= */
app.post("/api/verify-otp", (req, res) => {
  const { bookingId, otp } = req.body;

  if (otpStore[bookingId] != otp) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  activeSessions[bookingId] = true;
  res.json({ message: "OTP verified successfully", bookingId });
});

/* =========================
   START SESSION (Standard endpoint)
   ========================= */
app.post("/api/session/start", async (req, res) => {
  const { bookingId } = req.body;

  if (!activeSessions[bookingId]) {
    return res.status(403).json({ message: "OTP not verified" });
  }

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  // Unblock charger (existing)
  await fetch("http://localhost:3001/api/charger/unblock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId,
      start_Time: booking.start_Time,
      duration: booking.slotDuration
    })
  });

  // NEW: Start timer in CMS
  const startTimerRes = await fetch("http://localhost:3001/api/charger/start-timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId
    })
  });
  const startTimerData = await startTimerRes.json();

  // Store actual start time and sessionId for cost calculation
  sessionStartTimes[bookingId] = Date.now();
  if (startTimerData.sessionId) {
    sessionIds[bookingId] = startTimerData.sessionId;
  }

  // Clear late arrival timer since session started
  delete lateArrivalTimers[bookingId];

  res.json({
    message: "Charging session started",
    bookingId,
    sessionId: startTimerData.sessionId || bookingId,
    timestamp: startTimerData.timestamp
  });
});

/* =========================
   START SESSION (Legacy endpoint - kept for compatibility)
   ========================= */
app.post("/api/start-session", async (req, res) => {
  const { bookingId } = req.body;

  if (!activeSessions[bookingId]) {
    return res.status(403).json({ message: "OTP not verified" });
  }

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  // Unblock charger (existing)
  await fetch("http://localhost:3001/api/charger/unblock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId,
      start_Time: booking.start_Time,
      duration: booking.slotDuration
    })
  });

  // NEW: Start timer in CMS
  const startTimerRes = await fetch("http://localhost:3001/api/charger/start-timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId
    })
  });
  const startTimerData = await startTimerRes.json();

  // Store actual start time and sessionId for cost calculation
  sessionStartTimes[bookingId] = Date.now();
  if (startTimerData.sessionId) {
    sessionIds[bookingId] = startTimerData.sessionId;
  }

  // Clear late arrival timer and late fee timer since session started
  delete lateArrivalTimers[bookingId];
  if (lateFeeIntervals[bookingId]) {
    clearInterval(lateFeeIntervals[bookingId]);
    delete lateFeeIntervals[bookingId];
    console.log(`💰 LATE FEE TIMER STOPPED for booking ${bookingId}`);
  }

  res.json({
    message: "Charging session started",
    bookingId,
    sessionId: startTimerData.sessionId || bookingId,
    timestamp: startTimerData.timestamp
  });
});

/* =========================
   COMPLETE SESSION (UPDATED: Now calls CMS to stop timer and get totals)
   ========================= */
app.post("/api/complete-session", async (req, res) => {
  const { bookingId, nextBooking } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  // NEW: Stop timer in CMS and get energy/cost data
  const timerRes = await fetch("http://localhost:3001/api/charger/stop-timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId
    })
  });
  const timerData = await timerRes.json();

  // Update total energy for the charger using totalEnergy from CMS
  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (charger && timerData.totalEnergy) {
    charger.totalEnergy = parseFloat(timerData.totalEnergy);
  }

  // Calculate cost (only if charger found)
  let costData = null;
  if (charger) {
    const actualStartTime = sessionStartTimes[bookingId] || null;
    const actualEndTime = Date.now();
    costData = calculateCost(booking, charger, timerData, actualStartTime, actualEndTime);

    if (costData) {
      console.log("💰 COST SUMMARY (COMPLETE):", {
        bookingId,
        chargerId: booking.chargerId,
        total: costData.total.toFixed(2),
        subtotal: costData.subtotal.toFixed(2),
        gst: costData.gst.toFixed(2),
        energyCost: costData.energyCost.toFixed(2),
        bookingFee: costData.bookingFee.toFixed(2),
        idleFee: costData.idleFee.toFixed(2),
        lateArrivalFee: costData.lateArrivalFee.toFixed(2),
        earlyCancellationFee: costData.earlyCancellationFee.toFixed(2)
      });
    }
  }

  // Persist cost and payment status on booking for both UIs
  if (costData) {
    booking.sessionCost = costData;
    booking.paymentStatus = "pending";
  }
  booking.status = "COMPLETED";

  if (nextBooking === true) {
    await fetch("http://localhost:3001/api/charger/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargerId: booking.chargerId,
        bookingId,
        start_Time: booking.start_Time,
        duration: booking.slotDuration
      })
    });

    // Clear session data for next session
    delete activeSessions[bookingId];
    delete otpStore[bookingId];
    delete sessionStartTimes[bookingId];
    delete sessionIds[bookingId];

    const response = { 
      message: "Session completed. Charger blocked.", 
      bookingId,
      chargerId: booking.chargerId,
      sessionId: timerData.sessionId || sessionIds[bookingId] || bookingId,
      telemetry: {
        timestamp: timerData.timestamp,
        energyDelivered: timerData.sessionEnergy ? parseFloat(timerData.sessionEnergy) : 0,
        durationSeconds: timerData.durationSeconds ? parseFloat(timerData.durationSeconds) : 0
      },
      ...timerData
    };
    if (costData) {
      response.cost = costData;
      response.summary = {
        energyDelivered: costData.breakdown.energyConsumed,
        duration: `${(costData.breakdown.actualDurationHours).toFixed(2)} hours`,
        totalCost: costData.total
      };
    }
    return res.json(response);
  }

  await fetch("http://localhost:3001/api/charger/unblock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chargerId: booking.chargerId, bookingId })
  });

  // Clear session data for next session
  delete activeSessions[bookingId];
  delete otpStore[bookingId];
  delete sessionStartTimes[bookingId];
  delete sessionIds[bookingId];

  const response = { 
    message: "Session completed. Charger available.", 
    bookingId,
    chargerId: booking.chargerId,
    sessionId: timerData.sessionId || sessionIds[bookingId] || bookingId,
    telemetry: {
      timestamp: timerData.timestamp,
      energyDelivered: timerData.sessionEnergy ? parseFloat(timerData.sessionEnergy) : 0,
      durationSeconds: timerData.durationSeconds ? parseFloat(timerData.durationSeconds) : 0
    },
    ...timerData
  };
  if (costData) {
    response.cost = costData;
    response.summary = {
      energyDelivered: costData.breakdown.energyConsumed,
      duration: `${(costData.breakdown.actualDurationHours).toFixed(2)} hours`,
      totalCost: costData.total
    };
  }
  res.json(response);
});

/* =========================
   GET SESSION SUMMARY
   ========================= */
app.get("/api/session/summary/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  // Find booking by sessionId (sessionId might be bookingId)
  const booking = bookings.find(b => 
    b.bookingId === sessionId || sessionIds[b.bookingId] === sessionId
  );

  if (!booking) {
    return res.status(404).json({ message: "Session not found" });
  }

  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (!charger) {
    return res.status(404).json({ message: "Charger not found for this session" });
  }

  // Get telemetry from CMS
  let telemetry = null;
  try {
    const actualSessionId = sessionIds[booking.bookingId] || booking.bookingId;
    const telemetryRes = await fetch(`http://localhost:3001/api/charger/telemetry/${actualSessionId}`);
    if (telemetryRes.ok) {
      telemetry = await telemetryRes.json();
    }
  } catch (e) {
    console.error("Error fetching telemetry:", e);
  }

  // Calculate cost if we have telemetry
  let costData = null;
  if (telemetry && telemetry.status === "completed") {
    const actualStartTime = sessionStartTimes[booking.bookingId] || null;
    const actualEndTime = telemetry.timestamp;
    const timerData = {
      sessionEnergy: telemetry.energyDelivered,
      durationSeconds: telemetry.durationSeconds
    };
    costData = calculateCost(booking, charger, timerData, actualStartTime, actualEndTime);
  }

  res.json({
    sessionId: sessionIds[booking.bookingId] || booking.bookingId,
    bookingId: booking.bookingId,
    chargerId: booking.chargerId,
    status: booking.status,
    telemetry: telemetry || { message: "No telemetry data available" },
    cost: costData,
    booking: {
      date: booking.date,
      startTime: booking.start_Time,
      duration: booking.slotDuration
    }
  });
});

/* =========================
   POST COST CALCULATE (Standalone endpoint)
   ========================= */
app.post("/api/cost/calculate", async (req, res) => {
  const { bookingId, sessionId, timerData, actualStartTime, actualEndTime, cancelledBy } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (!charger) {
    return res.status(404).json({ message: "Charger not found" });
  }

  const costData = calculateCost(
    booking, 
    charger, 
    timerData || {}, 
    actualStartTime ? new Date(actualStartTime) : null,
    actualEndTime ? new Date(actualEndTime) : null,
    cancelledBy
  );

  res.json({
    bookingId,
    sessionId: sessionId || bookingId,
    cost: costData
  });
});

/* =========================
   AUTO COMPLETE SESSION (for auto-completed sessions)
   ========================= */
app.post("/api/session/auto-complete", async (req, res) => {
  const { bookingId } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  // Get telemetry from CMS
  const actualSessionId = sessionIds[booking.bookingId] || booking.bookingId;
  const telemetryRes = await fetch(`http://localhost:3001/api/charger/telemetry/${actualSessionId}`);
  const timerData = await telemetryRes.json();

  // Update total energy for the charger using totalEnergy from CMS
  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (charger && timerData.totalEnergy) {
    charger.totalEnergy = parseFloat(timerData.totalEnergy);
  }

  // Calculate cost (only if charger found)
  let costData = null;
  if (charger) {
    const actualStartTime = sessionStartTimes[bookingId] || null;
    const actualEndTime = timerData.timestamp || Date.now();
    costData = calculateCost(booking, charger, timerData, actualStartTime, actualEndTime);

    if (costData) {
      console.log("💰 COST SUMMARY (AUTO-COMPLETE):", {
        bookingId,
        chargerId: booking.chargerId,
        total: costData.total.toFixed(2),
        subtotal: costData.subtotal.toFixed(2),
        gst: costData.gst.toFixed(2),
        energyCost: costData.energyCost.toFixed(2),
        bookingFee: costData.bookingFee.toFixed(2),
        idleFee: costData.idleFee.toFixed(2),
        lateArrivalFee: costData.lateArrivalFee.toFixed(2),
        earlyCancellationFee: costData.earlyCancellationFee.toFixed(2)
      });
    }
  }

  // Persist cost and payment status on booking
  if (costData) {
    booking.sessionCost = costData;
    booking.paymentStatus = "pending";
  }
  booking.status = "COMPLETED";

  // Clear session data
  delete activeSessions[bookingId];
  delete otpStore[bookingId];
  delete sessionStartTimes[bookingId];
  delete sessionIds[bookingId];

  const response = {
    message: "Session auto-completed",
    bookingId,
    cost: costData
  };
  res.json(response);
});

/* =========================
   EXTEND SESSION (Standard endpoint)
   ========================= */
app.post("/api/session/extend", async (req, res) => {
  const { bookingId, newDuration, newDate, newStartTime } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  // Parse current duration
  const currentDurationMatch = booking.slotDuration.match(/(\d+(?:\.\d+)?)\s*Hours?/i);
  const currentDurationHours = currentDurationMatch ? parseFloat(currentDurationMatch[1]) : 0;

  // Update booking fields
  if (newDate) booking.date = newDate;
  if (newStartTime) booking.start_Time = newStartTime;
  if (newDuration) booking.slotDuration = `${newDuration} Hours`;

  // Update blocking in CMS with updated values
  try {
    await fetch("http://localhost:3001/api/charger/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargerId: booking.chargerId,
        bookingId,
        start_Time: booking.start_Time,
        duration: booking.slotDuration
      })
    });
  } catch (e) {
    console.error("Error updating block in CMS:", e);
  }

  res.json({
    message: "Session extended successfully",
    bookingId,
    oldDuration: `${currentDurationHours} Hours`,
    newDuration: newDuration ? `${newDuration} Hours` : booking.slotDuration,
    booking
  });
});

/* =========================
   EXTEND SESSION (Legacy endpoint - kept for compatibility)
   ========================= */
app.post("/api/extend-session", async (req, res) => {
  const { bookingId, newDuration } = req.body; // newDuration in hours

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  // Parse current duration
  const currentDurationMatch = booking.slotDuration.match(/(\d+(?:\.\d+)?)\s*Hours?/i);
  const currentDurationHours = currentDurationMatch ? parseFloat(currentDurationMatch[1]) : 0;
  
  // Update booking duration
  booking.slotDuration = `${newDuration} Hours`;

  // Update blocking in CMS with new duration
  try {
    await fetch("http://localhost:3001/api/charger/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargerId: booking.chargerId,
        bookingId,
        start_Time: booking.start_Time,
        duration: `${newDuration} Hours`
      })
    });
  } catch (e) {
    console.error("Error updating block in CMS:", e);
  }

  res.json({ 
    message: "Session extended successfully", 
    bookingId, 
    oldDuration: `${currentDurationHours} Hours`,
    newDuration: `${newDuration} Hours`,
    booking 
  });
});

/* =========================
   CANCEL BOOKING (Standard endpoint)
   ========================= */
app.post("/api/booking/cancel", async (req, res) => {
  const { bookingId } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (activeSessions[bookingId]) {
    return res.status(400).json({ message: "Cannot cancel booking after session has started" });
  }

  const now = new Date();
  const slotStart = parseDateTime(booking.date, booking.start_Time);
  const timeDiff = slotStart - now;
  const isLateCancellation = timeDiff <= 60 * 60 * 1000; // within 60 minutes

  // If not started, unblock in CMS
  await fetch("http://localhost:3001/api/charger/unblock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId
    })
  });

  // Update charger status to AVAILABLE
  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (charger) {
    charger.status = "AVAILABLE";
  }

  // Update booking status
  booking.status = "CANCELLED";

  let message = "Booking cancelled successfully";
  if (isLateCancellation) {
    message += ". Late cancellation fee applied.";
  }

  res.json({ message, bookingId, lateFee: isLateCancellation });
});

/* =========================
   CANCEL BOOKING (Legacy endpoint - kept for compatibility)
   ========================= */
app.post("/api/cancel-booking", async (req, res) => {
  const { bookingId } = req.body;

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (activeSessions[bookingId]) {
    return res.status(400).json({ message: "Cannot cancel booking after session has started" });
  }

  const now = new Date();
  const slotStart = parseDateTime(booking.date, booking.start_Time);
  const timeDiff = slotStart - now;
  const isLateCancellation = timeDiff <= 60 * 60 * 1000; // within 60 minutes

  // If not started, unblock in CMS
  await fetch("http://localhost:3001/api/charger/unblock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargerId: booking.chargerId,
      bookingId
    })
  });

  // Update charger status to AVAILABLE
  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (charger) {
    charger.status = "AVAILABLE";
  }

  // Update booking status
  booking.status = "CANCELLED";

  let message = "Booking cancelled successfully";
  if (isLateCancellation) {
    message += ". Late cancellation fee applied.";
  }

  res.json({ message, bookingId, lateFee: isLateCancellation });
});

/* =========================
   CANCEL SESSION (Standard endpoint)
   ========================= */
app.post("/api/session/cancel", async (req, res) => {
  const { bookingId, cancelledBy } = req.body; // cancelledBy: "HOST" | "DRIVER" | undefined

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (!activeSessions[bookingId]) {
    return res.status(400).json({ message: "Cannot cancel session before it starts" });
  }

  // Stop charging in CMS (stop timer)
  let timerData = {};
  try {
    const timerRes = await fetch("http://localhost:3001/api/charger/stop-timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargerId: booking.chargerId,
        bookingId
      })
    });
    timerData = await timerRes.json();
  } catch (e) {
    // If CMS is down, still proceed with cancellation in backend state.
    timerData = {
      message: "Could not stop timer in CMS",
      totalEnergy: 0,
      durationSeconds: 0,
      sessionEnergy: 0
    };
  }

  // Update total energy for the charger using totalEnergy from CMS
  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (charger && timerData.totalEnergy) {
    charger.totalEnergy = parseFloat(timerData.totalEnergy);
  }

  // Make charger available again in CMS and backend
  try {
    await fetch("http://localhost:3001/api/charger/unblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chargerId: booking.chargerId, bookingId })
    });
  } catch (e) {
    // ignore
  }

  if (charger) {
    charger.status = "AVAILABLE";
  }

  booking.status = "CANCELLED_IN_PROGRESS";
  booking.cancelledBy = cancelledBy || "UNKNOWN";
  booking.cancelledAt = new Date().toISOString();

  // Calculate cost with cancellation (only if charger found)
  let costData = null;
  if (charger) {
    const actualStartTime = sessionStartTimes[bookingId] || null;
    const actualEndTime = Date.now();
    costData = calculateCost(booking, charger, timerData, actualStartTime, actualEndTime, cancelledBy);

    if (costData) {
      booking.sessionCost = costData;
      booking.paymentStatus = "pending";
      console.log("💰 COST SUMMARY (CANCELLED):", {
        bookingId,
        chargerId: booking.chargerId,
        cancelledBy: booking.cancelledBy,
        total: costData.total.toFixed(2),
        subtotal: costData.subtotal.toFixed(2),
        gst: costData.gst.toFixed(2),
        energyCost: costData.energyCost.toFixed(2),
        bookingFee: costData.bookingFee.toFixed(2),
        idleFee: costData.idleFee.toFixed(2),
        lateArrivalFee: costData.lateArrivalFee.toFixed(2),
        earlyCancellationFee: costData.earlyCancellationFee.toFixed(2)
      });
    }
  }

  delete activeSessions[bookingId];
  delete otpStore[bookingId];
  delete sessionStartTimes[bookingId];
  delete sessionIds[bookingId];

  const response = {
    message: "Session cancelled. Charging stopped.",
    bookingId,
    sessionId: timerData.sessionId || sessionIds[bookingId] || bookingId,
    cancelledBy: booking.cancelledBy,
    status: timerData.status || "success",
    telemetry: {
      timestamp: timerData.timestamp,
      energyDelivered: timerData.sessionEnergy ? parseFloat(timerData.sessionEnergy) : 0,
      durationSeconds: timerData.durationSeconds ? parseFloat(timerData.durationSeconds) : 0
    },
    ...timerData
  };
  if (costData) {
    response.cost = costData;
  }
  res.json(response);
});

/* =========================
   CANCEL SESSION (Legacy endpoint - kept for compatibility)
   ========================= */
app.post("/api/cancel-session", async (req, res) => {
  const { bookingId, cancelledBy } = req.body; // cancelledBy: "HOST" | "DRIVER" | undefined

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (!activeSessions[bookingId]) {
    return res.status(400).json({ message: "Cannot cancel session before it starts" });
  }

  // Stop charging in CMS (stop timer)
  let timerData = {};
  try {
    const timerRes = await fetch("http://localhost:3001/api/charger/stop-timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargerId: booking.chargerId,
        bookingId
      })
    });
    timerData = await timerRes.json();
  } catch (e) {
    // If CMS is down, still proceed with cancellation in backend state.
    timerData = { 
      message: "Could not stop timer in CMS",
      totalEnergy: 0,
      durationSeconds: 0
    };
  }

  // Make charger available again in CMS and backend
  try {
    await fetch("http://localhost:3001/api/charger/unblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chargerId: booking.chargerId, bookingId })
    });
  } catch (e) {
    // ignore
  }

  const charger = chargers.find(c => c.chargerId === booking.chargerId);
  if (charger) {
    charger.status = "AVAILABLE";
  }

  booking.status = "CANCELLED_IN_PROGRESS";
  booking.cancelledBy = cancelledBy || "UNKNOWN";
  booking.cancelledAt = new Date().toISOString();

  // Calculate cost with cancellation (only if charger found)
  let costData = null;
  if (charger) {
    const actualStartTime = sessionStartTimes[bookingId] || null;
    const actualEndTime = Date.now();
    costData = calculateCost(booking, charger, timerData, actualStartTime, actualEndTime, cancelledBy);

    if (costData) {
      booking.sessionCost = costData;
      booking.paymentStatus = "pending";
      console.log("💰 COST SUMMARY (CANCELLED):", {
        bookingId,
        chargerId: booking.chargerId,
        cancelledBy: booking.cancelledBy,
        total: costData.total.toFixed(2),
        subtotal: costData.subtotal.toFixed(2),
        gst: costData.gst.toFixed(2),
        energyCost: costData.energyCost.toFixed(2),
        bookingFee: costData.bookingFee.toFixed(2),
        idleFee: costData.idleFee.toFixed(2),
        lateArrivalFee: costData.lateArrivalFee.toFixed(2),
        earlyCancellationFee: costData.earlyCancellationFee.toFixed(2)
      });
    }
  }

  delete activeSessions[bookingId];
  delete otpStore[bookingId];
  delete sessionStartTimes[bookingId];

  const response = {
    message: "Session cancelled. Charging stopped.",
    bookingId,
    chargerId: booking.chargerId,
    sessionId: timerData.sessionId || sessionIds[bookingId] || bookingId,
    cancelledBy: booking.cancelledBy,
    status: timerData.status || "success",
    telemetry: {
      timestamp: timerData.timestamp,
      energyDelivered: timerData.sessionEnergy ? parseFloat(timerData.sessionEnergy) : 0,
      durationSeconds: timerData.durationSeconds ? parseFloat(timerData.durationSeconds) : 0
    },
    ...timerData
  };
  if (costData) {
    response.cost = costData;
  }
  res.json(response);
});

/* =========================
   SERVER START
   ========================= */
app.listen(5000, () => {
  console.log("✅ kcbackend running on http://localhost:5000");
});