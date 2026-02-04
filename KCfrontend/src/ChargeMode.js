import { useEffect, useState } from "react";
import { getChargers, bookCharger, requestOtp, cancelBooking, cancelSession, getChargerTimerStatus, extendSession, getBooking, markBookingPaid, getBookingTimerStatus, autoCompleteSession } from "./api";

function ChargeMode({ onDriverBookingsChange, refreshAllChargersTrigger, onConsumeAllChargersTrigger, bookingCountdownTimers, setBookingCountdownTimers }) {
  const [chargers, setChargers] = useState([]);
  const [bookingMap, setBookingMap] = useState({});
  const [myBookings, setMyBookings] = useState([]);
  const [disabledBookings, setDisabledBookings] = useState(new Set()); // Track disabled bookings
  const [dismissedBookings, setDismissedBookings] = useState(new Set()); // Track bookings where buttons should be hidden
  const [timersByCharger, setTimersByCharger] = useState({}); // chargerId -> { running, elapsedSeconds }
  const [sessionCosts, setSessionCosts] = useState({}); // bookingId -> cost data (for cancelled in this tab)
  const [bookingDetails, setBookingDetails] = useState({}); // bookingId -> { sessionCost, paymentStatus } from API
  const [payingBookingId, setPayingBookingId] = useState(null);
  const [bookingTimers, setBookingTimers] = useState({}); // bookingId -> timer status
  const [durationModal, setDurationModal] = useState({ visible: false, chargerId: null }); // For duration selection modal
  const [selectedDuration, setSelectedDuration] = useState(null); // Selected duration for booking

  // Load driver state from localStorage on mount (mode-switch independent)
  useEffect(() => {
    const savedDismissed = localStorage.getItem('dismissedBookings');
    const savedBookingMap = localStorage.getItem('driverBookingMap');
    if (savedDismissed) {
      try {
        const dismissedArray = JSON.parse(savedDismissed);
        setDismissedBookings(new Set(dismissedArray));
      } catch (e) {
        console.error('Error loading dismissed bookings:', e);
      }
    }
    if (savedBookingMap) {
      try {
        const map = JSON.parse(savedBookingMap);
        if (map && typeof map === 'object' && Object.keys(map).length > 0) {
          setBookingMap(map);
        }
      } catch (e) {
        console.error('Error loading driver booking map:', e);
      }
    }
  }, []);

  // Save driver bookingMap so it survives mode switch (OTP request stays available)
  useEffect(() => {
    if (Object.keys(bookingMap).length > 0) {
      localStorage.setItem('driverBookingMap', JSON.stringify(bookingMap));
    } else {
      localStorage.removeItem('driverBookingMap');
    }
  }, [bookingMap]);

  // Save driverBookings for App-level "Request OTP" strip (visible in any mode)
  useEffect(() => {
    if (myBookings.length > 0) {
      const list = myBookings.map((b) => ({
        bookingId: b.bookingId,
        chargerId: b.chargerId,
        date: b.date,
        start_Time: b.start_Time
      }));
      localStorage.setItem('driverBookings', JSON.stringify(list));
      onDriverBookingsChange?.();
    } else {
      localStorage.removeItem('driverBookings');
      onDriverBookingsChange?.();
    }
  }, [myBookings, onDriverBookingsChange]);

  // Save dismissed bookings to localStorage whenever it changes
  useEffect(() => {
    if (dismissedBookings.size > 0) {
      localStorage.setItem('dismissedBookings', JSON.stringify(Array.from(dismissedBookings)));
    }
  }, [dismissedBookings]);

  const load = async () => {
    const data = await getChargers();
    setChargers(data);
  };

  // ✅ SAME 15-MIN CHECK (UNCHANGED LOGIC)
  const canRequestOtpNow = (date, start_Time) => {
    const now = new Date();

    let year, month, day;
    if (date.includes("/")) {
      [day, month, year] = date.split("/");
    } else {
      [year, month, day] = date.split("-");
    }

    let hour = 0,
      minute = 0;

    if (
      start_Time.toLowerCase().includes("am") ||
      start_Time.toLowerCase().includes("pm")
    ) {
      hour = parseInt(start_Time);
      if (start_Time.toLowerCase().includes("pm") && hour !== 12) hour += 12;
      if (start_Time.toLowerCase().includes("am") && hour === 12) hour = 0;
    } else {
      [hour, minute] = start_Time.split(":").map(Number);
    }

    const slotStart = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0
    );

    const otpAllowedTime = new Date(slotStart.getTime() - 15 * 60 * 1000);
    return now >= otpAllowedTime;
  };

  useEffect(() => {
    load();
  }, []);

  const handleBook = async (chargerId, duration) => {
    const res = await bookCharger({ chargerId, duration });
    const bookingId = res.booking.bookingId;

    setBookingMap((prev) => ({
      ...prev,
      [chargerId]: bookingId,
    }));

    // Clear dismissed bookings for new booking (reset state for new booking)
    setDismissedBookings(new Set());
    localStorage.removeItem('dismissedBookings');

    alert("Booking Successful!\nBooking ID: " + bookingId);

    // Start 50-second countdown timer
    setBookingCountdownTimers(prev => ({
      ...prev,
      [chargerId]: { remainingSeconds: 50, running: true }
    }));

    load();
    refreshAllChargersTrigger(Date.now()); // Trigger refresh for both UIs
  };

  const handleDurationSelect = (duration) => {
    const chargerId = durationModal.chargerId;
    setDurationModal({ visible: false, chargerId: null });
    handleBook(chargerId, duration);
  };

  /* =========================
     REQUEST OTP (✅ UPDATED)
     ========================= */
  const handleRequestOtp = async (bookingId, date, start_Time) => {
    if (!canRequestOtpNow(date, start_Time)) {
      alert("⏳ OTP will be sent automatically 15 minutes before session start");
      return;
    }

    const res = await requestOtp(bookingId);

    if (res.otp) {
      alert("OTP Received!\nOTP: " + res.otp); // testing only
    } else {
      alert(res.message);
    }
  };

  const parseDateTime = (date, time) => {
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
  };

  const isWithin60Minutes = (date, time) => {
    const now = new Date();
    const slotStart = parseDateTime(date, time);
    const timeDiff = slotStart - now;
    return timeDiff <= 60 * 60 * 1000 && timeDiff > 0;
  };

  const handleCancelBooking = async (bookingId) => {
    if (window.confirm("Are you sure you want to cancel this booking?")) {
      try {
        const res = await cancelBooking(bookingId);
        alert(res.message);
        if (res.lateFee) {
          alert("Late cancellation fee applied.");
        }
        // Hide buttons for this booking (persisted in localStorage)
        const newDismissed = new Set([...dismissedBookings, bookingId]);
        setDismissedBookings(newDismissed);
        localStorage.setItem('dismissedBookings', JSON.stringify(Array.from(newDismissed)));
        // Disable buttons for this booking
        setDisabledBookings(prev => new Set([...prev, bookingId]));
        // Remove from bookingMap
        const chargerId = Object.keys(bookingMap).find(key => bookingMap[key] === bookingId);
        if (chargerId) {
          setBookingMap(prev => {
            const newMap = { ...prev };
            delete newMap[chargerId];
            return newMap;
          });
        }
        // Remove from myBookings
        setMyBookings(prev => prev.filter(b => b.bookingId !== bookingId));
        load();
        refreshAllChargersTrigger(Date.now()); // Trigger refresh for both UIs
      } catch (error) {
        alert("Error cancelling booking: " + error.message);
      }
    }
  };

  const handleContinueBooking = (bookingId) => {
    alert("Continuing with booking");
    // Hide buttons for this booking (persisted in localStorage)
    const newDismissed = new Set([...dismissedBookings, bookingId]);
    setDismissedBookings(newDismissed);
    localStorage.setItem('dismissedBookings', JSON.stringify(Array.from(newDismissed)));
    // Disable buttons for this booking
    setDisabledBookings(prev => new Set([...prev, bookingId]));
  };

  const handleCancelSession = async (bookingId) => {
    if (window.confirm("Are you sure you want to cancel the session in progress? This will stop charging.")) {
      try {
        const res = await cancelSession(bookingId, "DRIVER");
        alert(res.message || "Session cancelled");

        if (res.cost) {
          setSessionCosts((prev) => ({ ...prev, [bookingId]: res.cost }));
          setBookingDetails((prev) => ({
            ...prev,
            [bookingId]: { sessionCost: res.cost, paymentStatus: "pending" }
          }));
        }

        // Keep booking in list so driver can see "Amount to pay" and "Make payment"
        load();
        refreshAllChargersTrigger(Date.now()); // Trigger refresh for both UIs
      } catch (error) {
        alert("Error cancelling session: " + error.message);
      }
    }
  };

  const handleExtendBooking = async (bookingId) => {
    const currentBooking = myBookings.find(b => b.bookingId === bookingId);
    if (!currentBooking) return;

    const currentDurationMatch = currentBooking.slotDuration.match(/(\d+(?:\.\d+)?)\s*Hours?/i);
    const currentDurationHours = currentDurationMatch ? parseFloat(currentDurationMatch[1]) : 0;

    const newDuration = prompt(
      `Current booking duration: ${currentDurationHours} hours\nEnter new duration in hours:`,
      currentDurationHours + 1
    );

    if (!newDuration || isNaN(parseFloat(newDuration)) || parseFloat(newDuration) <= currentDurationHours) {
      alert("Invalid duration. Must be greater than current duration.");
      return;
    }

    try {
      const res = await extendSession(bookingId, parseFloat(newDuration));
      alert(res.message || "Booking extended successfully");

      // Update booking in myBookings
      setMyBookings(prev => prev.map(b =>
        b.bookingId === bookingId
          ? { ...b, slotDuration: `${newDuration} Hours` }
          : b
      ));

      load();
    } catch (error) {
      alert("Error extending booking: " + error.message);
    }
  };

  const handleExtendTime = async (bookingId) => {
    const newDuration = prompt("Enter new duration in hours:");
    if (newDuration && !isNaN(parseFloat(newDuration))) {
      try {
        await extendSession(bookingId, parseFloat(newDuration));
        alert("Session extended successfully");
        // Update booking in myBookings
        setMyBookings(prev => prev.map(b =>
          b.bookingId === bookingId
            ? { ...b, slotDuration: `${newDuration} Hours` }
            : b
        ));
        load();
      } catch (error) {
        alert("Error extending session: " + error.message);
      }
    }
  };

  const handleExtendDate = async (bookingId) => {
    const newDate = prompt("Enter new date (YYYY-MM-DD):");
    if (newDate) {
      try {
        await extendSession(bookingId, null, newDate);
        alert("Session extended successfully");
        // Update booking in myBookings
        setMyBookings(prev => prev.map(b =>
          b.bookingId === bookingId
            ? { ...b, date: newDate }
            : b
        ));
        load();
      } catch (error) {
        alert("Error extending session: " + error.message);
      }
    }
  };

  const handleExtendBoth = async (bookingId) => {
    const newDate = prompt("Enter new date (YYYY-MM-DD):");
    const newTime = prompt("Enter new start time (HH:MM):");
    const newDuration = prompt("Enter new duration in hours:");
    if (newDate && newTime && newDuration && !isNaN(parseFloat(newDuration))) {
      try {
        await extendSession(bookingId, parseFloat(newDuration), newDate, newTime);
        alert("Session extended successfully");
        // Update booking in myBookings
        setMyBookings(prev => prev.map(b =>
          b.bookingId === bookingId
            ? { ...b, date: newDate, start_Time: newTime, slotDuration: `${newDuration} Hours` }
            : b
        ));
        load();
      } catch (error) {
        alert("Error extending session: " + error.message);
      }
    }
  };

  // Update myBookings when bookingMap changes
  useEffect(() => {
    const bookings = [];
    Object.keys(bookingMap).forEach(chargerId => {
      const charger = chargers.find(c => c.chargerId === chargerId);
      if (charger) {
        bookings.push({
          bookingId: bookingMap[chargerId],
          chargerId,
          date: charger.date,
          start_Time: charger.start_Time,
          slotDuration: charger.slotDuration,
          status: "BOOKING CONFIRMED"
        });
      }
    });
    setMyBookings(bookings);
  }, [bookingMap, chargers]);

  // Fetch sessionCost & paymentStatus from backend for each myBooking (so we show Amount to pay / Make payment)
  const myBookingIds = myBookings.map((b) => b.bookingId).sort().join(",");
  useEffect(() => {
    if (!myBookingIds) return;
    const ids = myBookingIds.split(",").filter(Boolean);
    let cancelled = false;
    const fetchAll = async () => {
      const next = {};
      for (const bid of ids) {
        try {
          const data = await getBooking(bid);
          if (!cancelled && data && (data.sessionCost || data.paymentStatus)) {
            next[bid] = { sessionCost: data.sessionCost, paymentStatus: data.paymentStatus };
          }
        } catch (e) {
          // ignore
        }
      }
      if (!cancelled) setBookingDetails((prev) => ({ ...prev, ...next }));
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [myBookingIds]);

  // Poll CMS for live timer for any charger the driver has booked
  // Polls all chargers to catch active sessions started in Host Mode
  useEffect(() => {
    const pollTimers = async () => {
      const nextTimers = {};

      // Poll all chargers to find active timers
      for (const charger of chargers) {
        try {
          const status = await getChargerTimerStatus(charger.chargerId);
          // Show timer if it's running or completed AND driver has booked this charger
          if (status && (status.running || status.completed)) {
            // Check if driver has booked this charger
            const hasBooking = bookingMap[charger.chargerId] ||
                              myBookings.some(b => b.chargerId === charger.chargerId);

            if (hasBooking) {
              nextTimers[charger.chargerId] = status;

              // If completed and no cost yet, auto-complete the session
              if (status.completed && hasBooking) {
                const bookingId = bookingMap[charger.chargerId] ||
                                  myBookings.find(b => b.chargerId === charger.chargerId)?.bookingId;
                if (bookingId && !bookingDetails[bookingId]?.sessionCost) {
                  try {
                    await autoCompleteSession(bookingId);
                    // Refresh booking details
                    const updatedBooking = await getBooking(bookingId);
                    setBookingDetails(prev => ({
                      ...prev,
                      [bookingId]: { sessionCost: updatedBooking.sessionCost, paymentStatus: updatedBooking.paymentStatus }
                    }));
                  } catch (e) {
                    console.error("Error auto-completing session:", e);
                  }
                }
              }
            }
          }
        } catch (e) {
          // ignore errors
        }
      }

      // Update timers state
      if (Object.keys(nextTimers).length > 0) {
        setTimersByCharger(nextTimers);
      } else {
        // Keep existing timers if no new ones found (don't clear immediately)
        // Only clear if we've checked and there are truly no timers
        const hasAnyActiveTimer = Object.values(timersByCharger).some(t => t.running);
        if (!hasAnyActiveTimer) {
          setTimersByCharger({});
        }
      }
    };

    // Poll immediately, then every second
    pollTimers();
    const interval = setInterval(pollTimers, 1000);

    return () => clearInterval(interval);
  }, [bookingMap, chargers, myBookings, timersByCharger, bookingDetails]);

  // When any cancellation happens (driver or host), refresh all chargers to update totalEnergy
  useEffect(() => {
    if (!refreshAllChargersTrigger || !onConsumeAllChargersTrigger) return;
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) onConsumeAllChargersTrigger();
    })();
    return () => { cancelled = true; };
  }, [refreshAllChargersTrigger, onConsumeAllChargersTrigger]);

  // Poll for booking timers
  useEffect(() => {
    if (!myBookings.length) return;
    const pollBookingTimers = async () => {
      const nextTimers = {};
      for (const booking of myBookings) {
        try {
          const status = await getBookingTimerStatus(booking.bookingId);
          if (status) {
            nextTimers[booking.bookingId] = status;

            // Show message when timer expires and late arrival detected
            const prevStatus = bookingTimers[booking.bookingId];
            if (prevStatus && prevStatus.remainingSeconds > 0 && status.remainingSeconds <= 0 && status.lateArrival) {
              alert("🚨 Late Arrival Detected! A late fee will be charged each minute until you start the session. Please arrive on time for future bookings.");
            }
          }
        } catch (e) {
          // ignore
        }
      }
      setBookingTimers(nextTimers);
    };

    // Poll immediately, then every second
    pollBookingTimers();
    const interval = setInterval(pollBookingTimers, 1000);

    return () => clearInterval(interval);
  }, [myBookings, bookingTimers]);

  // Show late fee notification when booking countdown timer expires
  useEffect(() => {
    Object.keys(bookingCountdownTimers).forEach(chargerId => {
      const timer = bookingCountdownTimers[chargerId];
      if (timer && timer.remainingSeconds === 0 && timer.running === false) {
        // Check if we haven't already shown the alert for this charger
        const alertKey = `lateFeeAlert_${chargerId}`;
        if (!localStorage.getItem(alertKey)) {
          alert("🚨 Timer Expired! A late fee of ₹5 per minute will be charged to the EV driver until the session starts.");
          localStorage.setItem(alertKey, 'shown');
        }
      }
    });
  }, [bookingCountdownTimers]);



  return (
    <div>
      <h2>Charge Mode</h2>

      {/* Duration Selection Modal */}
      {durationModal.visible && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: 20,
            borderRadius: 8,
            maxWidth: 400,
            width: '90%'
          }}>
            <h3>Select Duration</h3>
            <p>Choose the duration for your charging session:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {['2MIN', '30MIN', '45MIN', '1HR', '1.5HR', '2HR'].map((duration) => (
                <button
                  key={duration}
                  onClick={() => handleDurationSelect(duration)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 16
                  }}
                >
                  {duration}
                </button>
              ))}
            </div>
            <button
              onClick={() => setDurationModal({ visible: false, chargerId: null })}
              style={{
                marginTop: 20,
                padding: '10px 20px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {chargers.map((c) => (
        <div
          key={c.chargerId}
          style={{
            border: "1px solid #000",
            padding: 10,
            marginBottom: 10,
            maxWidth: 400,
            backgroundColor: "#fff9c4",
          }}
        >
          <p><b>Host:</b> {c.hostName}</p>
          <p><b>Charger:</b> {c.brand} ({c.connector})</p>
          <p><b>Status:</b> {c.status}</p>
          <p><b>Location:</b> {c.location}</p>
          <p><b>Date:</b> {c.date}</p>
          <p><b>Slot Duration:</b> {c.slotDuration} hr</p>
          <p><b>Total Energy Delivered:</b> {c.totalEnergy} kWh</p>

          {/* Booking Countdown Timer */}
          {c.status === "BOOKED" && bookingCountdownTimers[c.chargerId] && bookingCountdownTimers[c.chargerId].running && (
            <div style={{
              marginTop: 10,
              marginBottom: 10,
              width: 200,
              padding: 10,
              backgroundColor: "#fff3e0",
              borderRadius: 10,
              border: "2px solid #ff9800",
              textAlign: "center"
            }}>
              <p style={{ margin: "0 0 6px 0", fontWeight: "bold", fontSize: 14 }}>
                ⏳ Arriving Timer
              </p>
              <p style={{ margin: 0, fontSize: 22, fontWeight: "bold", fontFamily: "monospace" }}>
                {new Date((bookingCountdownTimers[c.chargerId].remainingSeconds || 0) * 1000).toISOString().substr(14, 5)}
              </p>
            </div>
          )}

          {c.status === "AVAILABLE" ? (
            <button
              onClick={() => setDurationModal({ visible: true, chargerId: c.chargerId })}
              style={{
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              BOOK
            </button>
          ) : (
            <>
              <button
                disabled
                style={{
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  padding: "8px 16px",
                  fontWeight: "bold",
                  cursor: "not-allowed",
                }}
              >
                BOOKED
              </button>

              {/* ✅ OTP BUTTON ALWAYS VISIBLE AFTER BOOKING */}
              {bookingMap[c.chargerId] && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() =>
                      handleRequestOtp(
                        bookingMap[c.chargerId],
                        c.date,
                        c.start_Time
                      )
                    }
                    style={{
                      backgroundColor: "#ff9800",
                      color: "white",
                      border: "none",
                      padding: "6px 14px",
                      fontWeight: "bold",
                      cursor: "pointer",
                    }}
                  >
                    REQUEST OTP
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* My Bookings Section */}
      {myBookings.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>My Bookings</h3>
          {myBookings.map((booking, index) => (
            <div key={index} style={{ marginBottom: 10, padding: 10, backgroundColor: "#e8f5e9", borderRadius: 4 }}>
              <p><strong>Booking ID:</strong> {booking.bookingId}</p>
              <p><strong>Charger ID:</strong> {booking.chargerId}</p>
              <p><strong>Date:</strong> {booking.date}</p>
              <p><strong>Start Time:</strong> {booking.start_Time}</p>
              <p><strong>Duration:</strong> {booking.slotDuration} Hours</p>
              <p><strong>Status:</strong> {booking.status}</p>

              {/* Late Arrival Timer */}
              {bookingTimers[booking.bookingId] && bookingTimers[booking.bookingId].hasTimer && (
                <div style={{
                  marginTop: 10,
                  marginBottom: 10,
                  width: 200,
                  padding: 10,
                  backgroundColor: bookingTimers[booking.bookingId].lateArrival ? "#ffebee" : "#fff3e0",
                  borderRadius: 10,
                  border: bookingTimers[booking.bookingId].lateArrival ? "2px solid #f44336" : "2px solid #ff9800",
                  textAlign: "center"
                }}>
                  <p style={{ margin: "0 0 6px 0", fontWeight: "bold", fontSize: 14 }}>
                    {bookingTimers[booking.bookingId].lateArrival ? "⏰ Late Arrival Detected" : "⏳ Arrival Timer"}
                  </p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: "bold", fontFamily: "monospace" }}>
                    {new Date((bookingTimers[booking.bookingId].remainingSeconds || 0) * 1000).toISOString().substr(11, 8)}
                  </p>
                  {bookingTimers[booking.bookingId].lateArrival && (
                    <p style={{ margin: "6px 0 0 0", fontSize: 12, color: "#d32f2f", fontWeight: "bold" }}>
                      Late arrival fee will be applied
                    </p>
                  )}
                </div>
              )}

              {/* Charging session: timer + Cancel during charging */}
              {timersByCharger[booking.chargerId] &&
               (timersByCharger[booking.chargerId].running || timersByCharger[booking.chargerId].completed) && (
                <div style={{
                  marginTop: 10,
                  marginBottom: 10,
                  width: 200,
                  padding: 10,
                  backgroundColor: timersByCharger[booking.chargerId].running ? "#e8f5e9" : "#f5f5f5",
                  borderRadius: 10,
                  border: timersByCharger[booking.chargerId].running ? "2px solid #4caf50" : "5px solid #bdbdbd",
                  textAlign: "center"
                }}>
                  <p style={{ margin: "0 0 6px 0", fontWeight: "bold", fontSize: 14 }}>
                    {timersByCharger[booking.chargerId].running ? "⚡ Charging in progress" : "Session completed"}
                  </p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: "bold", fontFamily: "monospace" }}>
                    {new Date(
                      (timersByCharger[booking.chargerId].elapsedSeconds || 0) * 1000
                    ).toISOString().substr(11, 8)}
                  </p>
                  {timersByCharger[booking.chargerId].running && (
                    <button
                      onClick={() => handleCancelSession(booking.bookingId)}
                      style={{
                        marginTop: 12,
                        backgroundColor: "#d32f2f",
                        color: "white",
                        border: "none",
                        padding: "10px 20px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: "bold",
                        fontSize: 14
                      }}
                    >
                      Cancel session
                    </button>
                  )}
                </div>
              )}

              {/* Cost summary & Make payment (completed or cancelled session) */}
              {(() => {
                const cost = sessionCosts[booking.bookingId] || bookingDetails[booking.bookingId]?.sessionCost;
                const paymentStatus = bookingDetails[booking.bookingId]?.paymentStatus;
                if (!cost) return null;
                const total = typeof cost.total === "number" ? cost.total.toFixed(2) : "0.00";
                return (
                  <div style={{
                    marginTop: 12,
                    padding: 14,
                    backgroundColor: "#fff8e1",
                    borderRadius: 8,
                    border: "2px solid #ff9800",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)"
                  }}>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: 15, color: "#e65100", borderBottom: "1px solid #ffcc80", paddingBottom: 6 }}>
                      💰 Cost summary
                    </h4>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                      <p style={{ margin: "4px 0" }}><strong>Energy cost:</strong> ₹{cost.energyCost?.toFixed(2) || "0.00"}</p>
                      <p style={{ margin: "4px 0" }}><strong>Booking fee:</strong> ₹{cost.bookingFee?.toFixed(2) || "0.00"}</p>
                      {(cost.lateArrivalFee || 0) > 0 && (
                        <p style={{ margin: "4px 0", color: "#c62828" }}><strong>Late arrival fee:</strong> ₹{cost.lateArrivalFee.toFixed(2)}</p>
                      )}
                      {(cost.idleFee || 0) > 0 && (
                        <p style={{ margin: "4px 0", color: "#c62828" }}><strong>Idle fee:</strong> ₹{cost.idleFee.toFixed(2)}</p>
                      )}
                      {(cost.earlyCancellationFee || 0) !== 0 && (
                        <p style={{ margin: "4px 0", color: cost.earlyCancellationFee > 0 ? "#c62828" : "#2e7d32" }}>
                          <strong>Early cancellation fee:</strong> ₹{cost.earlyCancellationFee.toFixed(2)}
                        </p>
                      )}
                      {cost.energyDelivered && (
                        <p style={{ margin: "4px 0" }}><strong>Energy delivered:</strong> {cost.energyDelivered.toFixed(2)} kWh</p>
                      )}
                      <hr style={{ margin: "8px 0", borderColor: "#ffcc80" }} />
                      <p style={{ margin: "4px 0" }}><strong>Subtotal:</strong> ₹{cost.subtotal?.toFixed(2) || "0.00"}</p>
                      <p style={{ margin: "4px 0" }}><strong>GST (18%):</strong> ₹{cost.gst?.toFixed(2) || "0.00"}</p>
                      <p style={{ margin: "10px 0 12px 0", fontSize: 18, fontWeight: "bold", color: cost.total < 0 ? "#2e7d32" : "#e65100" }}>
                        {cost.total < 0 ? `Refund: ₹${Math.abs(cost.total).toFixed(2)}` : `Amount to pay: ₹${total}`}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {paymentStatus === "paid" ? (
                        <span style={{ fontWeight: "bold", color: "#2e7d32", fontSize: 14 }}>✓ Payment made</span>
                      ) : (
                        <button
                          disabled={payingBookingId === booking.bookingId}
                          onClick={async () => {
                            setPayingBookingId(booking.bookingId);
                            try {
                              await markBookingPaid(booking.bookingId);
                              setBookingDetails((prev) => ({
                                ...prev,
                                [booking.bookingId]: { ...prev[booking.bookingId], sessionCost: cost, paymentStatus: "paid" }
                              }));
                            } catch (e) {
                              alert("Payment failed: " + (e.message || "Unknown error"));
                            } finally {
                              setPayingBookingId(null);
                            }
                          }}
                          style={{
                            padding: "10px 20px",
                            backgroundColor: payingBookingId === booking.bookingId ? "#9e9e9e" : "#4caf50",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: payingBookingId === booking.bookingId ? "wait" : "pointer",
                            fontWeight: "bold",
                            fontSize: 14
                          }}
                        >
                          {payingBookingId === booking.bookingId ? "Processing…" : "Make payment"}
                        </button>
                      )}
                      {sessionCosts[booking.bookingId] && (
                        <button
                          onClick={() => setSessionCosts((prev) => {
                            const next = { ...prev };
                            delete next[booking.bookingId];
                            return next;
                          })}
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#ff9800",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12
                          }}
                        >
                          Close
                        </button>
                      )}
                    </div>

                    {/* Extend options for completed sessions */}
                    {timersByCharger[booking.chargerId] && timersByCharger[booking.chargerId].completed && (
                      <div style={{ marginTop: 12, padding: 10, backgroundColor: "#e3f2fd", borderRadius: 6 }}>
                        <h5 style={{ margin: "0 0 8px 0", fontSize: 14, color: "#1976d2" }}>Extend Charging Session</h5>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            onClick={() => handleExtendTime(booking.bookingId)}
                            style={{
                              padding: "6px 12px",
                              backgroundColor: "#2196f3",
                              color: "white",
                              border: "none",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12
                            }}
                          >
                            Extend Time
                          </button>
                          <button
                            onClick={() => handleExtendDate(booking.bookingId)}
                            style={{
                              padding: "6px 12px",
                              backgroundColor: "#2196f3",
                              color: "white",
                              border: "none",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12
                            }}
                          >
                            Extend Date
                          </button>
                          <button
                            onClick={() => handleExtendBoth(booking.bookingId)}
                            style={{
                              padding: "6px 12px",
                              backgroundColor: "#2196f3",
                              color: "white",
                              border: "none",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12
                            }}
                          >
                            Extend Both
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {booking.status !== "CANCELLED" && booking.status !== "CANCELLED_IN_PROGRESS" && (
                <>
                  {bookingCountdownTimers[booking.chargerId] && bookingCountdownTimers[booking.chargerId].remainingSeconds === 0 && !bookingCountdownTimers[booking.chargerId].running && !dismissedBookings.has(booking.bookingId) ? (
                    <div style={{ marginTop: 10, padding: 10, backgroundColor: "#fff3e0", borderRadius: 4 }}>
                      <p><strong>Timer Expired:</strong> The arriving timer has ended. Do you want to cancel or continue this booking?</p>
                      <button
                        onClick={() => handleCancelBooking(booking.bookingId)}
                        disabled={disabledBookings.has(booking.bookingId)}
                        style={{
                          backgroundColor: disabledBookings.has(booking.bookingId) ? "#ccc" : "#f44336",
                          color: "white",
                          border: "none",
                          padding: "8px 16px",
                          fontWeight: "bold",
                          cursor: disabledBookings.has(booking.bookingId) ? "not-allowed" : "pointer",
                          marginRight: 10
                        }}
                      >
                        Cancel Booking
                      </button>
                      <button
                        onClick={() => handleContinueBooking(booking.bookingId)}
                        disabled={disabledBookings.has(booking.bookingId)}
                        style={{
                          backgroundColor: disabledBookings.has(booking.bookingId) ? "#ccc" : "#4CAF50",
                          color: "white",
                          border: "none",
                          padding: "8px 16px",
                          fontWeight: "bold",
                          cursor: disabledBookings.has(booking.bookingId) ? "not-allowed" : "pointer"
                        }}
                      >
                        Continue
                      </button>
                    </div>
                  ) : isWithin60Minutes(booking.date, booking.start_Time) && !dismissedBookings.has(booking.bookingId) ? (
                    <div style={{ marginTop: 10, padding: 10, backgroundColor: "#fff3e0", borderRadius: 4 }}>
                      <p><strong>Reminder (60 min):</strong> Do you want to cancel or continue this booking?</p>
                      <button
                        onClick={() => handleCancelBooking(booking.bookingId)}
                        disabled={disabledBookings.has(booking.bookingId)}
                        style={{
                          backgroundColor: disabledBookings.has(booking.bookingId) ? "#ccc" : "#f44336",
                          color: "white",
                          border: "none",
                          padding: "8px 16px",
                          fontWeight: "bold",
                          cursor: disabledBookings.has(booking.bookingId) ? "not-allowed" : "pointer",
                          marginRight: 10
                        }}
                      >
                        Cancel Booking
                      </button>
                      <button
                        onClick={() => handleContinueBooking(booking.bookingId)}
                        disabled={disabledBookings.has(booking.bookingId)}
                        style={{
                          backgroundColor: disabledBookings.has(booking.bookingId) ? "#ccc" : "#4CAF50",
                          color: "white",
                          border: "none",
                          padding: "8px 16px",
                          fontWeight: "bold",
                          cursor: disabledBookings.has(booking.bookingId) ? "not-allowed" : "pointer"
                        }}
                      >
                        Continue
                      </button>
                    </div>
                  ) : !isWithin60Minutes(booking.date, booking.start_Time) ? (
                    <div style={{ marginTop: 10, padding: 10, backgroundColor: "#e3f2fd", borderRadius: 4 }}>
                      <p><strong>Reminder:</strong> Cancel/Continue options will appear 60 minutes before start.</p>
                      <button
                        onClick={() => handleExtendBooking(booking.bookingId)}
                        style={{
                          marginTop: 8,
                          backgroundColor: "#2196f3",
                          color: "white",
                          border: "none",
                          padding: "6px 12px",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: "bold",
                          fontSize: 12
                        }}
                      >
                        Extend Booking
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChargeMode;
