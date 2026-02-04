const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let chargerStates = {};
let timers = {};  // chargerId → { intervalId, totalEnergy, startTime, sessionId }
let totalEnergyMap = {};  // chargerId → totalEnergy (persistent across sessions)
let completedTimers = {};  // chargerId → { elapsedSeconds, completedAt, sessionId, sessionEnergy } - stores final timer after stop
let sessionMap = {};  // sessionId → { chargerId, bookingId, startTime, energy, status }

// Constants
const ENERGY_PER_SECOND = 0.01;  // kWh per second (adjust as needed)

/* =========================
   BLOCK CHARGER (Standard endpoint)
   ========================= */
app.post("/api/charger/block", (req, res) => {
  const { chargerId, bookingId, start_Time, duration } = req.body;

  chargerStates[chargerId] = {
    chargerId,
    bookingId,
    start_Time,
    duration,
    status: "BLOCKED"
  };

  console.log("🔴 CHARGER BLOCKED:", chargerStates[chargerId]);

  res.json({
    message: "Charger blocked successfully",
    charger: chargerStates[chargerId]
  });
});

/* =========================
   UNBLOCK CHARGER (Standard endpoint)
   ========================= */
app.post("/api/charger/unblock", (req, res) => {
  const { chargerId, bookingId, start_Time, duration } = req.body;

  chargerStates[chargerId] = {
    chargerId,
    bookingId,
    start_Time,
    duration,
    status: "UNBLOCKED"
  };

  console.log("🟢 CHARGER UNBLOCKED:", chargerStates[chargerId]);

  res.json({
    message: "Charger unblocked successfully",
    charger: chargerStates[chargerId]
  });
});

/* =========================
   START SESSION (Starts energy accumulation)
   ========================= */
// Standard endpoint
app.post("/api/charger/start-timer", (req, res) => {
  const { chargerId, bookingId } = req.body;

  if (timers[chargerId]) {
    return res.status(400).json({ message: "Timer already running for this charger" });
  }

  // Generate sessionId (using bookingId as sessionId for now, can be separate)
  const sessionId = bookingId || `SESSION-${Date.now()}`;

  // Clear any previous completed timer when starting a new session
  if (completedTimers[chargerId]) {
    delete completedTimers[chargerId];
  }

  const startTime = Date.now();
  timers[chargerId] = {
    intervalId: null,
    totalEnergy: 0,
    startTime: startTime,
    sessionId: sessionId
  };

  // Store session mapping
  sessionMap[sessionId] = {
    chargerId,
    bookingId,
    startTime: startTime,
    energy: 0,
    status: "in_progress"
  };

  // Start interval to accumulate energy and check for auto-completion
  timers[chargerId].intervalId = setInterval(() => {
    timers[chargerId].totalEnergy += ENERGY_PER_SECOND;
    if (sessionMap[sessionId]) {
      sessionMap[sessionId].energy = timers[chargerId].totalEnergy;
    }

    // Check for auto-completion based on booked duration
    const chargerState = chargerStates[chargerId];
    if (chargerState && chargerState.duration) {
      const durationHours = parseFloat(chargerState.duration);
      const durationSeconds = durationHours * 3600; // Convert hours to seconds
      const elapsedSeconds = (Date.now() - timers[chargerId].startTime) / 1000;

      if (elapsedSeconds >= durationSeconds) {
        console.log(`⏰ AUTO-COMPLETING SESSION for charger ${chargerId}, session ${sessionId} - Duration reached`);
        // Auto-complete the session
        clearInterval(timers[chargerId].intervalId);

        const sessionEnergy = timers[chargerId].totalEnergy;
        const durationSecondsFinal = (Date.now() - timers[chargerId].startTime) / 1000;

        if (!totalEnergyMap[chargerId]) {
          totalEnergyMap[chargerId] = 0;
        }
        totalEnergyMap[chargerId] += sessionEnergy;

        const timestamp = Date.now();

        completedTimers[chargerId] = {
          elapsedSeconds: Math.floor(durationSecondsFinal),
          completedAt: timestamp,
          sessionEnergy: sessionEnergy,
          sessionId: sessionId,
          autoCompleted: true // Mark as auto-completed
        };

        if (sessionMap[sessionId]) {
          sessionMap[sessionId].energy = sessionEnergy;
          sessionMap[sessionId].status = "auto_completed";
          sessionMap[sessionId].completedAt = timestamp;
          sessionMap[sessionId].durationSeconds = Math.floor(durationSecondsFinal);
        }

        delete timers[chargerId];

        // Notify backend about auto-completion
        fetch("http://localhost:5000/api/complete-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId: chargerState.bookingId,
            nextBooking: false, // Auto-complete doesn't set next booking
            autoCompleted: true
          })
        }).catch(e => console.error("Error notifying backend of auto-completion:", e));
      }
    }
  }, 1000);  // Every second

  console.log(`⏱️ SESSION STARTED for charger ${chargerId}, booking ${bookingId}, session ${sessionId}`);

  res.json({ 
    message: "Session started", 
    chargerId, 
    bookingId,
    sessionId,
    timestamp: startTime
  });
});

// Alternative endpoint name as per spec
app.post("/api/charger/start-session", (req, res) => {
  // Reuse the same logic
  const { chargerId, bookingId } = req.body;

  if (timers[chargerId]) {
    return res.status(400).json({ message: "Timer already running for this charger" });
  }

  const sessionId = bookingId || `SESSION-${Date.now()}`;

  if (completedTimers[chargerId]) {
    delete completedTimers[chargerId];
  }

  const startTime = Date.now();
  timers[chargerId] = {
    intervalId: null,
    totalEnergy: 0,
    startTime: startTime,
    sessionId: sessionId
  };

  sessionMap[sessionId] = {
    chargerId,
    bookingId,
    startTime: startTime,
    energy: 0,
    status: "in_progress"
  };

  timers[chargerId].intervalId = setInterval(() => {
    timers[chargerId].totalEnergy += ENERGY_PER_SECOND;
    if (sessionMap[sessionId]) {
      sessionMap[sessionId].energy = timers[chargerId].totalEnergy;
    }
  }, 1000);

  console.log(`⏱️ SESSION STARTED for charger ${chargerId}, booking ${bookingId}, session ${sessionId}`);

  res.json({ 
    message: "Session started", 
    chargerId, 
    bookingId,
    sessionId,
    timestamp: startTime
  });
});

/* =========================
   STOP SESSION (Stops timer, calculates totals, logs to terminal)
   ========================= */
// Standard endpoint
app.post("/api/charger/stop-timer", (req, res) => {
  const { chargerId, bookingId } = req.body;

  if (!timers[chargerId]) {
    return res.status(400).json({ message: "No timer running for this charger" });
  }

  // Stop the timer
  clearInterval(timers[chargerId].intervalId);

  const sessionEnergy = timers[chargerId].totalEnergy;  // in kWh
  const durationSeconds = (Date.now() - timers[chargerId].startTime) / 1000;

  // Accumulate total energy for the charger
  if (!totalEnergyMap[chargerId]) {
    totalEnergyMap[chargerId] = 0;
  }
  totalEnergyMap[chargerId] += sessionEnergy;

  // Log to CMS terminal
  console.log(`🔋 SESSION COMPLETED for charger ${chargerId}, booking ${bookingId}`);
  console.log(`   Total Energy Delivered: ${totalEnergyMap[chargerId].toFixed(2)} kWh`);
  console.log(`   Duration: ${durationSeconds.toFixed(0)} seconds`);

  const sessionId = timers[chargerId].sessionId;
  const timestamp = Date.now();

  // Store final elapsed time and session energy before cleanup
  completedTimers[chargerId] = {
    elapsedSeconds: Math.floor(durationSeconds),
    completedAt: timestamp,
    sessionEnergy: sessionEnergy,  // Store session energy for this specific session
    sessionId: sessionId
  };

  // Update session mapping
  if (sessionMap[sessionId]) {
    sessionMap[sessionId].energy = sessionEnergy;
    sessionMap[sessionId].status = "completed";
    sessionMap[sessionId].completedAt = timestamp;
    sessionMap[sessionId].durationSeconds = Math.floor(durationSeconds);
  }

  // Clean up active timer
  delete timers[chargerId];

  const response = {
    message: "Session stopped",
    chargerId,
    bookingId,
    sessionId,
    sessionEnergy: parseFloat(sessionEnergy.toFixed(2)),  // Energy for this session only
    totalEnergy: parseFloat(totalEnergyMap[chargerId].toFixed(2)),  // Total energy across all sessions
    durationSeconds: Math.floor(durationSeconds),
    timestamp: timestamp,  // Timestamp when session stopped
    status: "success"
  };
  res.json(response);
});

// Alternative endpoint name as per spec: POST /cms/stop-session
app.post("/api/charger/stop-session", (req, res) => {
  // Reuse the same logic as stop-timer
  const { chargerId, bookingId } = req.body;

  if (!timers[chargerId]) {
    return res.status(400).json({ message: "No timer running for this charger" });
  }

  clearInterval(timers[chargerId].intervalId);

  const sessionEnergy = timers[chargerId].totalEnergy;
  const durationSeconds = (Date.now() - timers[chargerId].startTime) / 1000;

  if (!totalEnergyMap[chargerId]) {
    totalEnergyMap[chargerId] = 0;
  }
  totalEnergyMap[chargerId] += sessionEnergy;

  console.log(`🔋 SESSION STOPPED for charger ${chargerId}, booking ${bookingId}`);

  const sessionId = timers[chargerId].sessionId;
  const timestamp = Date.now();

  completedTimers[chargerId] = {
    elapsedSeconds: Math.floor(durationSeconds),
    completedAt: timestamp,
    sessionEnergy: sessionEnergy,
    sessionId: sessionId
  };

  if (sessionMap[sessionId]) {
    sessionMap[sessionId].energy = sessionEnergy;
    sessionMap[sessionId].status = "completed";
    sessionMap[sessionId].completedAt = timestamp;
    sessionMap[sessionId].durationSeconds = Math.floor(durationSeconds);
  }

  delete timers[chargerId];

  res.json({
    message: "Session stopped",
    chargerId,
    bookingId,
    sessionId,
    sessionEnergy: parseFloat(sessionEnergy.toFixed(2)),
    totalEnergy: parseFloat(totalEnergyMap[chargerId].toFixed(2)),
    durationSeconds: Math.floor(durationSeconds),
    timestamp: timestamp,
    status: "success"
  });
});

/* =========================
   GET CHARGER STATUS
   ========================= */
app.get("/api/charger/:chargerId", (req, res) => {
  const { chargerId } = req.params;

  res.json({
    chargerId,
    state: chargerStates[chargerId] || {
      chargerId,
      status: "AVAILABLE"
    }
  });
});

/* =========================
   GET LIVE TIMER STATUS FOR CHARGER
   ========================= */
app.get("/api/charger/:chargerId/timer-status", (req, res) => {
  const { chargerId } = req.params;
  const timer = timers[chargerId];
  const completedTimer = completedTimers[chargerId];

  // If timer is currently running, return live elapsed time
  if (timer) {
    const elapsedSeconds = Math.floor((Date.now() - timer.startTime) / 1000);
    return res.json({
      chargerId,
      running: true,
      elapsedSeconds
    });
  }

  // If timer was completed, return final elapsed time (persist for display)
  if (completedTimer) {
    return res.json({
      chargerId,
      running: false,
      elapsedSeconds: completedTimer.elapsedSeconds,
      completed: true
    });
  }

  // No timer found
  return res.json({
    chargerId,
    running: false,
    elapsedSeconds: 0
  });
});

/* =========================
   GET TOTAL ENERGY FOR CHARGER
   ========================= */
app.get("/api/charger/:chargerId/total-energy", (req, res) => {
  const { chargerId } = req.params;

  const totalEnergy = totalEnergyMap[chargerId] || 0;

  res.json({
    chargerId,
    totalEnergy: totalEnergy.toFixed(2)
  });
});

/* =========================
   GET TELEMETRY DATA FOR SESSION
   Returns timestamp, energyDelivered, chargerId, sessionId
   ========================= */
// Standard endpoint
app.get("/api/charger/telemetry/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  
  const session = sessionMap[sessionId];
  
  if (!session) {
    return res.status(404).json({
      message: "No telemetry data found for this session",
      sessionId
    });
  }

  const { chargerId, bookingId, startTime, energy, status, completedAt, durationSeconds } = session;
  
  res.json({
    sessionId,
    chargerId,
    bookingId,
    timestamp: completedAt || Date.now(),
    energyDelivered: parseFloat(energy.toFixed(2)),
    durationSeconds: durationSeconds || Math.floor((Date.now() - startTime) / 1000),
    status: status || "in_progress"
  });
});

/* =========================
   GET TELEMETRY DATA FOR BOOKING (Legacy endpoint - kept for compatibility)
   ========================= */
app.get("/api/charger/:chargerId/telemetry/:bookingId", (req, res) => {
  const { chargerId, bookingId } = req.params;
  
  const completedTimer = completedTimers[chargerId];
  const totalEnergy = totalEnergyMap[chargerId] || 0;
  
  if (completedTimer) {
    // Return session-specific energy if available, otherwise use total energy
    const energyDelivered = completedTimer.sessionEnergy !== undefined 
      ? completedTimer.sessionEnergy 
      : totalEnergy;
    
    res.json({
      chargerId,
      bookingId,
      sessionId: completedTimer.sessionId,
      timestamp: completedTimer.completedAt,
      energyDelivered: parseFloat(energyDelivered.toFixed(2)),
      durationSeconds: completedTimer.elapsedSeconds,
      status: "completed"
    });
  } else {
    // If no completed timer, check if there's an active timer
    const activeTimer = timers[chargerId];
    if (activeTimer) {
      const currentEnergy = activeTimer.totalEnergy;
      const currentDuration = Math.floor((Date.now() - activeTimer.startTime) / 1000);
      res.json({
        chargerId,
        bookingId,
        sessionId: activeTimer.sessionId,
        timestamp: Date.now(),
        energyDelivered: parseFloat(currentEnergy.toFixed(2)),
        durationSeconds: currentDuration,
        status: "in_progress"
      });
    } else {
      res.status(404).json({
        message: "No telemetry data found for this booking",
        chargerId,
        bookingId
      });
    }
  }
});

app.listen(3001, () => {
  console.log("⚡ CMS running on http://localhost:3001");
});
