import { useState, useEffect, useCallback, useRef } from "react";
import HostMode from "./HostMode";
import ChargeMode from "./ChargeMode";
import { verifyOtp, startSession, getChargerTimerStatus, completeSession, cancelSession, getChargers, getBookingsByCharger, requestOtp, autoCompleteSession } from "./api";

function App() {
  const [mode, setMode] = useState("");
  
  // Charging Session Control state (persists across mode switches)
  const [otp, setOtp] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [verified, setVerified] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [timerStatus, setTimerStatus] = useState(null);
  const [chargerBookings, setChargerBookings] = useState([]);
  const [sessionCost, setSessionCost] = useState(null); // Store cost data for completed sessions
  const [cancelledSessionCost, setCancelledSessionCost] = useState(null); // Store cost data for cancelled sessions
  const [refreshHostBookingsTrigger, setRefreshHostBookingsTrigger] = useState(null); // bookingId when host just completed/cancelled, so HostMode can refresh
  const [refreshAllChargersTrigger, setRefreshAllChargersTrigger] = useState(null); // timestamp when any cancellation happens, to refresh both UIs
  const [driverBookings, setDriverBookings] = useState([]); // Driver bookings for Request OTP (mode-switch independent)
  const [bookingCountdownTimers, setBookingCountdownTimers] = useState({}); // chargerId -> {remainingSeconds, running} (mode-switch independent)
  const bookingIdRef = useRef(null); // Ref for bookingId input to manage focus

  const syncDriverBookingsFromStorage = useCallback(() => {
    try {
      const raw = localStorage.getItem("driverBookings");
      const list = raw ? JSON.parse(raw) : [];
      setDriverBookings(Array.isArray(list) ? list : []);
    } catch (e) {
      setDriverBookings([]);
    }
  }, []);

  // Load session state from localStorage on mount (persists across mode switches)
  useEffect(() => {
    const savedBookingId = localStorage.getItem('sessionBookingId');
    const savedOtp = localStorage.getItem('sessionOtp');
    const savedVerified = localStorage.getItem('sessionVerified');
    const savedSessionStarted = localStorage.getItem('sessionStarted');
    const savedBookings = localStorage.getItem('chargerBookings');
    const savedSessionCost = localStorage.getItem('sessionCost');
    const savedCancelledSessionCost = localStorage.getItem('cancelledSessionCost');
    const savedBookingCountdownTimers = localStorage.getItem('bookingCountdownTimers');

    if (savedBookingId) setBookingId(savedBookingId);
    if (savedOtp) setOtp(savedOtp);
    if (savedVerified === 'true') setVerified(true);
    if (savedSessionStarted === 'true') setSessionStarted(true);
    if (savedBookings) setChargerBookings(JSON.parse(savedBookings));
    if (savedSessionCost) {
      try {
        setSessionCost(JSON.parse(savedSessionCost));
      } catch (e) {}
    }
    if (savedCancelledSessionCost) {
      try {
        setCancelledSessionCost(JSON.parse(savedCancelledSessionCost));
      } catch (e) {}
    }
    if (savedBookingCountdownTimers) {
      try {
        setBookingCountdownTimers(JSON.parse(savedBookingCountdownTimers));
      } catch (e) {}
    }
    syncDriverBookingsFromStorage();
  }, [syncDriverBookingsFromStorage]);

  // Re-sync driver bookings when switching mode so Request OTP strip is up to date
  useEffect(() => {
    syncDriverBookingsFromStorage();
  }, [mode, syncDriverBookingsFromStorage]);

  // Save session state to localStorage whenever it changes
  useEffect(() => {
    if (bookingId) localStorage.setItem('sessionBookingId', bookingId);
    else localStorage.removeItem('sessionBookingId');
  }, [bookingId]);

  useEffect(() => {
    if (otp) localStorage.setItem('sessionOtp', otp);
    else localStorage.removeItem('sessionOtp');
  }, [otp]);

  useEffect(() => {
    localStorage.setItem('sessionVerified', verified ? 'true' : 'false');
  }, [verified]);

  useEffect(() => {
    localStorage.setItem('sessionStarted', sessionStarted ? 'true' : 'false');
  }, [sessionStarted]);

  // Save booking countdown timers to localStorage whenever it changes
  useEffect(() => {
    if (Object.keys(bookingCountdownTimers).length > 0) {
      localStorage.setItem('bookingCountdownTimers', JSON.stringify(bookingCountdownTimers));
    } else {
      localStorage.removeItem('bookingCountdownTimers');
    }
  }, [bookingCountdownTimers]);

  // Poll CMS for timer status (works across mode switches)
  useEffect(() => {
    if (!bookingId) return;

    const booking = chargerBookings.find(b => b.bookingId === bookingId);
    const chargerIdToPoll = booking?.chargerId;
    
    if (!chargerIdToPoll) return;

    const pollTimer = async () => {
      try {
        const status = await getChargerTimerStatus(chargerIdToPoll);
        setTimerStatus(status);
        // Update sessionStarted based on CMS timer status
        if (status.running) {
          setSessionStarted(true);
        } else if (status.completed) {
          setSessionStarted(false);
          // Auto-complete session if not already done
          if (!sessionCost) {
            try {
              const res = await autoCompleteSession(bookingId);
              if (res.cost) {
                setSessionCost(res.cost);
                localStorage.setItem('sessionCost', JSON.stringify(res.cost));
              }
            } catch (e) {
              console.error("Error auto-completing session:", e);
            }
          }
        } else if (!status.running && !status.completed) {
          setSessionStarted(false);
        }
      } catch (error) {
        // Ignore errors
      }
    };

    pollTimer();
    const interval = setInterval(pollTimer, 1000);
    return () => clearInterval(interval);
  }, [bookingId, chargerBookings]);

  // Countdown timer interval for booking timers (mode-switch independent)
  useEffect(() => {
    const interval = setInterval(() => {
      setBookingCountdownTimers(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(chargerId => {
          if (next[chargerId].running && next[chargerId].remainingSeconds > 0) {
            next[chargerId].remainingSeconds -= 1;
            if (next[chargerId].remainingSeconds <= 0) {
              next[chargerId].running = false;
            }
          }
        });
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Load bookings when bookingId changes
  useEffect(() => {
    if (!bookingId) {
      setChargerBookings([]);
      return;
    }
    
    const loadBookings = async () => {
      try {
        const chargers = await getChargers();

        // Search through all chargers to find the booking
        for (const charger of chargers) {
          const chargerBookings = await getBookingsByCharger(charger.chargerId);
          const booking = chargerBookings.find(b => b.bookingId === bookingId);
          if (booking) {
            setChargerBookings(chargerBookings);
            break;
          }
        }
      } catch (error) {
        console.error('Error loading bookings:', error);
      }
    };
    
    loadBookings();
  }, [bookingId]);

  const handleVerifyOtp = async () => {
    try {
      await verifyOtp(bookingId, otp);
      alert("OTP Verified");
      setVerified(true);
    } catch (error) {
      alert("Error verifying OTP: " + (error.message || "Unknown error"));
    }
  };

  const handleStartSession = async () => {
    try {
      const res = await startSession(bookingId);
      alert("Charging session started");
      setSessionStarted(true);
    } catch (error) {
      alert("Error starting session: " + (error.message || "Unknown error"));
    }
  };

  const handleCompleteSession = async () => {
    const nextBooking = window.confirm(
      "Is there a next booking?\nOK = Block for next booking\nCancel = Keep charger free"
    );

    try {
      const res = await completeSession(bookingId, nextBooking);
      if (res.message && res.message.includes("Error")) {
        alert(res.message);
        return;
      }

      setRefreshHostBookingsTrigger(bookingId);

      alert(
        nextBooking
          ? "Session completed & charger blocked for next booking"
          : "Session completed, charger remains unblocked"
      );

      // Reset charging session control for next session
      setBookingId("");
      setOtp("");
      setVerified(false);
      setSessionStarted(false);
      setTimerStatus(null);

      // Clear cost summaries for new session
      setSessionCost(null);
      setCancelledSessionCost(null);

      // Clear localStorage for session data
      localStorage.removeItem('sessionBookingId');
      localStorage.removeItem('sessionOtp');
      localStorage.removeItem('sessionVerified');
      localStorage.removeItem('sessionStarted');

      // Focus the bookingId input for next session
      setTimeout(() => {
        if (bookingIdRef.current) {
          bookingIdRef.current.focus();
        }
      }, 100);
    } catch (error) {
      alert("Error completing session: " + error.message);
    }
  };

  const handleCancelSession = async () => {
    if (!bookingId) {
      alert("Please enter Booking ID");
      return;
    }

    if (window.confirm("Are you sure you want to cancel the session in progress? This will stop charging.")) {
      try {
        const res = await cancelSession(bookingId, "HOST");
        alert(res.message || "Session cancelled");
        
        // Store cost data if available
        if (res.cost) {
          setCancelledSessionCost(res.cost);
          localStorage.setItem('cancelledSessionCost', JSON.stringify(res.cost));
        }
        setRefreshHostBookingsTrigger(bookingId);
        setRefreshAllChargersTrigger(Date.now()); // Trigger refresh for both UIs

        // Reset session state
        setBookingId("");
        setOtp("");
        setVerified(false);
        setSessionStarted(false);
        setTimerStatus(null);

        localStorage.removeItem('sessionBookingId');
        localStorage.removeItem('sessionOtp');
        localStorage.removeItem('sessionVerified');
        localStorage.removeItem('sessionStarted');

        // Focus the bookingId input for next session
        setTimeout(() => {
          if (bookingIdRef.current) {
            bookingIdRef.current.focus();
          }
        }, 100);
      } catch (error) {
        alert("Error cancelling session: " + error.message);
      }
    }
  };

  // Driver: OTP allowed from 15 min before slot start (mode-switch independent)
  const canRequestOtpNow = (date, start_Time) => {
    let year, month, day;
    if (date.includes("/")) {
      [day, month, year] = date.split("/");
    } else {
      [year, month, day] = date.split("-");
    }
    let hour = 0, minute = 0;
    if (String(start_Time).toLowerCase().includes("am") || String(start_Time).toLowerCase().includes("pm")) {
      const t = String(start_Time).toLowerCase();
      hour = parseInt(t, 10) || 0;
      if (t.includes("pm") && hour !== 12) hour += 12;
      if (t.includes("am") && hour === 12) hour = 0;
    } else {
      [hour, minute] = String(start_Time).split(":").map(Number);
    }
    const slotStart = new Date(Number(year), Number(month) - 1, Number(day), hour, minute, 0);
    const otpAllowedTime = new Date(slotStart.getTime() - 15 * 60 * 1000);
    return new Date() >= otpAllowedTime;
  };

  return (
    <div
      style={{
        padding: 20,
        minHeight: "100vh",
        backgroundColor: "#d4f8d4" // light green background
      }}
    >
      <h1>KaroCharge App</h1>

      <button
        style={{
          backgroundColor: "yellow",
          padding: "10px 20px",
          marginRight: 10,
          border: "none",
          cursor: "pointer",
          fontWeight: "bold"
        }}
        onClick={() => setMode("HOST")}
      >
        HOST MODE
      </button>

      <button
        style={{
          backgroundColor: "yellow",
          padding: "10px 20px",
          border: "none",
          cursor: "pointer",
          fontWeight: "bold"
        }}
        onClick={() => setMode("CHARGE")}
      >
        CHARGE MODE
      </button>

      <hr />

      {/* Charging Session Control - Full control in HOST mode, Timer only in CHARGE mode */}
      {mode === "HOST" && (
        <div style={{
          border: "1px solid #ccc",
          padding: 20,
          marginBottom: 20,
          backgroundColor: "#fff",
          borderRadius: 8,
          maxWidth: 500
        }}>
          <h3>Charging Session Control</h3>

          {/* Refresh button to clear session and start new */}
          <button
            onClick={() => {
              setBookingId("");
              setOtp("");
              setVerified(false);
              setSessionStarted(false);
              setTimerStatus(null);
              setSessionCost(null);
              setCancelledSessionCost(null);
              localStorage.removeItem('sessionBookingId');
              localStorage.removeItem('sessionOtp');
              localStorage.removeItem('sessionVerified');
              localStorage.removeItem('sessionStarted');
              localStorage.removeItem('sessionCost');
              localStorage.removeItem('cancelledSessionCost');
              setTimeout(() => {
                if (bookingIdRef.current) {
                  bookingIdRef.current.focus();
                }
              }, 100);
            }}
            style={{
              backgroundColor: "#9c27b0",
              color: "white",
              border: "none",
              padding: "8px 16px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              marginBottom: 10,
              float: "right"
            }}
            title="Refresh to start new session"
          >
            🔄 Refresh
          </button>

          {/* Show refresh/ready state when no booking ID entered */}
          {!bookingId && !verified && (
            <div style={{
              padding: 15,
              backgroundColor: "#f5f5f5",
              borderRadius: 4,
              textAlign: "center",
              marginBottom: 8
            }}>
              <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
                🔄 Ready for new session
              </p>
              <p style={{ margin: "4px 0 0 0", color: "#999", fontSize: 12 }}>
                Enter Booking ID and OTP to start
              </p>
            </div>
          )}

          {/* Only show OTP/Booking ID inputs if not verified yet */}
          {!verified && (
            <>
              <input
                ref={bookingIdRef}
                placeholder="Enter Booking ID"
                value={bookingId}
                onChange={(e) => {
                  setBookingId(e.target.value);
                  // Reset session state when starting new session
                  if (e.target.value) {
                    setOtp("");
                    setVerified(false);
                    setSessionStarted(false);
                    setTimerStatus(null);
                    setSessionCost(null);
                    setCancelledSessionCost(null);
                    // Clear localStorage for session data
                    localStorage.removeItem('sessionOtp');
                    localStorage.removeItem('sessionVerified');
                    localStorage.removeItem('sessionStarted');
                    localStorage.removeItem('sessionCost');
                    localStorage.removeItem('cancelledSessionCost');
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginBottom: 8,
                  border: "1px solid #ccc",
                  borderRadius: 4
                }}
              />

              <input
                placeholder="Enter OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginBottom: 8,
                  border: "1px solid #ccc",
                  borderRadius: 4
                }}
              />

              {bookingId && otp && (
                <button
                  onClick={handleVerifyOtp}
                  style={{
                    backgroundColor: "#2196f3",
                    color: "white",
                    border: "none",
                    padding: "10px",
                    width: "100%",
                    fontWeight: "bold",
                    cursor: "pointer",
                    borderRadius: 4
                  }}
                >
                  VERIFY OTP
                </button>
              )}
            </>
          )}

          {/* Show verified status if verified */}
          {verified && (
            <div style={{ marginBottom: 8, padding: 8, backgroundColor: "#e8f5e9", borderRadius: 4 }}>
              <p style={{ margin: 0, fontWeight: "bold", color: "#2e7d32" }}>✓ Verified</p>
              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#666" }}>Booking ID: {bookingId}</p>
            </div>
          )}

          {/* Session Timer Display - Shows in HOST mode when active */}
          {timerStatus && (timerStatus.running || timerStatus.completed) && (
            <div style={{ marginTop: 12, marginBottom: 8, padding: 10, backgroundColor: "#e3f2fd", borderRadius: 6, textAlign: "center" }}>
              <p style={{ margin: 0, fontWeight: "bold", fontSize: 16 }}>Session Timer</p>
              <p style={{ margin: "8px 0", fontSize: 24, fontWeight: "bold" }}>
                {new Date((timerStatus.elapsedSeconds || 0) * 1000).toISOString().substr(11, 8)}
              </p>
              {timerStatus.completed && (
                <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#666" }}>(Session Completed)</p>
              )}
              {timerStatus.running && (
                <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#2e7d32" }}>⏱️ Session in Progress</p>
              )}
            </div>
          )}

          {verified && !sessionStarted && (
            <button
              onClick={handleStartSession}
              style={{
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                padding: "10px",
                width: "100%",
                fontWeight: "bold",
                marginTop: 8,
                cursor: "pointer",
                borderRadius: 4
              }}
            >
              START SESSION
            </button>
          )}

          {sessionStarted && (
            <>
              <button
                onClick={handleCompleteSession}
                style={{
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  padding: "10px",
                  width: "100%",
                  fontWeight: "bold",
                  marginTop: 8,
                  cursor: "pointer",
                  borderRadius: 4
                }}
              >
                COMPLETE SESSION
              </button>
              <button
                onClick={handleCancelSession}
                style={{
                  backgroundColor: "#ff9800",
                  color: "white",
                  border: "none",
                  padding: "10px",
                  width: "100%",
                  fontWeight: "bold",
                  marginTop: 8,
                  cursor: "pointer",
                  borderRadius: 4
                }}
              >
                CANCEL SESSION
              </button>
            </>
          )}

          {/* Display Cost Summary after session completion or cancellation */}
          {sessionCost && (
            <div style={{
              marginTop: 15,
              padding: 15,
              backgroundColor: "#fff3e0",
              borderRadius: 8,
              border: "2px solid #ff9800"
            }}>
              <h4 style={{ margin: "0 0 10px 0", color: "#e65100" }}>💰 Session Cost Summary</h4>
              <div style={{ fontSize: 14 }}>
                <p style={{ margin: "4px 0" }}><strong>Energy Cost:</strong> ₹{sessionCost.energyCost?.toFixed(2) || "0.00"}</p>
                <p style={{ margin: "4px 0" }}><strong>Booking Fee:</strong> ₹{sessionCost.bookingFee?.toFixed(2) || "0.00"}</p>
                {sessionCost.lateArrivalFee > 0 && (
                  <p style={{ margin: "4px 0", color: "#d32f2f" }}>
                    <strong>Late Arrival Fee:</strong> ₹{sessionCost.lateArrivalFee.toFixed(2)}
                  </p>
                )}
                {sessionCost.idleFee > 0 && (
                  <p style={{ margin: "4px 0", color: "#d32f2f" }}>
                    <strong>Idle Fee:</strong> ₹{sessionCost.idleFee.toFixed(2)}
                  </p>
                )}
                {sessionCost.earlyCancellationFee !== 0 && (
                  <p style={{ margin: "4px 0", color: sessionCost.earlyCancellationFee > 0 ? "#d32f2f" : "#2e7d32" }}>
                    <strong>Early Cancellation Fee:</strong> ₹{sessionCost.earlyCancellationFee.toFixed(2)}
                  </p>
                )}
                {sessionCost.noShowFee > 0 && (
                  <p style={{ margin: "4px 0", color: "#d32f2f" }}>
                    <strong>No Show Fee:</strong> ₹{sessionCost.noShowFee.toFixed(2)}
                  </p>
                )}
                <hr style={{ margin: "8px 0", borderColor: "#ffcc80" }} />
                <p style={{ margin: "4px 0" }}><strong>Subtotal:</strong> ₹{sessionCost.subtotal?.toFixed(2) || "0.00"}</p>
                <p style={{ margin: "4px 0" }}><strong>GST (18%):</strong> ₹{sessionCost.gst?.toFixed(2) || "0.00"}</p>
                <p style={{ margin: "8px 0 0 0", fontSize: 18, fontWeight: "bold", color: "#e65100" }}>
                  <strong>Total:</strong> ₹{sessionCost.total?.toFixed(2) || "0.00"}
                </p>
              </div>
              <button
                onClick={() => {
                  setSessionCost(null);
                  localStorage.removeItem('sessionCost');
                }}
                style={{
                  marginTop: 10,
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
            </div>
          )}

          {/* Display Cost Summary after session cancellation */}
          {cancelledSessionCost && (
            <div style={{
              marginTop: 15,
              padding: 15,
              backgroundColor: "#ffebee",
              borderRadius: 8,
              border: "2px solid #f44336"
            }}>
              <h4 style={{ margin: "0 0 10px 0", color: "#c62828" }}>💰 Cancelled Session Cost Summary</h4>
              <div style={{ fontSize: 14 }}>
                <p style={{ margin: "4px 0" }}><strong>Energy Cost:</strong> ₹{cancelledSessionCost.energyCost?.toFixed(2) || "0.00"}</p>
                <p style={{ margin: "4px 0" }}><strong>Booking Fee:</strong> ₹{cancelledSessionCost.bookingFee?.toFixed(2) || "0.00"}</p>
                {cancelledSessionCost.lateArrivalFee > 0 && (
                  <p style={{ margin: "4px 0", color: "#d32f2f" }}>
                    <strong>Late Arrival Fee:</strong> ₹{cancelledSessionCost.lateArrivalFee.toFixed(2)}
                  </p>
                )}
                {cancelledSessionCost.idleFee > 0 && (
                  <p style={{ margin: "4px 0", color: "#d32f2f" }}>
                    <strong>Idle Fee:</strong> ₹{cancelledSessionCost.idleFee.toFixed(2)}
                  </p>
                )}
                {cancelledSessionCost.earlyCancellationFee !== 0 && (
                  <p style={{ margin: "4px 0", color: cancelledSessionCost.earlyCancellationFee > 0 ? "#d32f2f" : "#2e7d32" }}>
                    <strong>Early Cancellation Fee:</strong> ₹{cancelledSessionCost.earlyCancellationFee.toFixed(2)}
                    {cancelledSessionCost.earlyCancellationFee < 0 && " (Refunded - Host cancelled)"}
                  </p>
                )}
                {cancelledSessionCost.noShowFee > 0 && (
                  <p style={{ margin: "4px 0", color: "#d32f2f" }}>
                    <strong>No Show Fee:</strong> ₹{cancelledSessionCost.noShowFee.toFixed(2)}
                  </p>
                )}
                <hr style={{ margin: "8px 0", borderColor: "#ffcdd2" }} />
                <p style={{ margin: "4px 0" }}><strong>Subtotal:</strong> ₹{cancelledSessionCost.subtotal?.toFixed(2) || "0.00"}</p>
                <p style={{ margin: "4px 0" }}><strong>GST (18%):</strong> ₹{cancelledSessionCost.gst?.toFixed(2) || "0.00"}</p>
                <p style={{ margin: "8px 0 0 0", fontSize: 18, fontWeight: "bold", color: "#c62828" }}>
                  <strong>Total:</strong> ₹{cancelledSessionCost.total?.toFixed(2) || "0.00"}
                </p>
              </div>
              <button
                onClick={() => {
                  setCancelledSessionCost(null);
                  localStorage.removeItem('cancelledSessionCost');
                }}
                style={{
                  marginTop: 10,
                  padding: "6px 12px",
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12
                }}
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* Timer only display for CHARGE mode (no booking ID/OTP inputs) */}
      {mode === "CHARGE" && timerStatus && (timerStatus.running || timerStatus.completed) && (
        <div style={{
          border: "1px solid #ccc",
          padding: 20,
          marginBottom: 20,
          backgroundColor: "#fff",
          borderRadius: 8,
          maxWidth: 500
        }}>
          <h3>Session Timer</h3>
          <div style={{ marginTop: 12, marginBottom: 8, padding: 10, backgroundColor: "#e3f2fd", borderRadius: 6, textAlign: "center" }}>
            <p style={{ margin: 0, fontWeight: "bold", fontSize: 16 }}>Session Timer</p>
            <p style={{ margin: "8px 0", fontSize: 24, fontWeight: "bold" }}>
              {new Date((timerStatus.elapsedSeconds || 0) * 1000).toISOString().substr(11, 8)}
            </p>
            {timerStatus.completed && (
              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#666" }}>(Session Completed)</p>
            )}
            {timerStatus.running && (
              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#2e7d32" }}>⏱️ Session in Progress</p>
            )}
          </div>
        </div>
      )}

      <hr />

      {mode === "HOST" && (
          <HostMode
            sessionCost={sessionCost}
            cancelledSessionCost={cancelledSessionCost}
            refreshHostBookingsTrigger={refreshHostBookingsTrigger}
            refreshAllChargersTrigger={refreshAllChargersTrigger}
            onConsumeRefreshTrigger={() => setRefreshHostBookingsTrigger(null)}
            onConsumeAllChargersTrigger={() => setRefreshAllChargersTrigger(null)}
            bookingCountdownTimers={bookingCountdownTimers}
            setBookingCountdownTimers={setBookingCountdownTimers}
          />
        )}
      {mode === "CHARGE" && <ChargeMode onDriverBookingsChange={syncDriverBookingsFromStorage} refreshAllChargersTrigger={() => setRefreshAllChargersTrigger(Date.now())} refreshAllChargersTriggerState={refreshAllChargersTrigger} onConsumeAllChargersTrigger={() => setRefreshAllChargersTrigger(null)} bookingCountdownTimers={bookingCountdownTimers} setBookingCountdownTimers={setBookingCountdownTimers} />}
    </div>
  );
}

export default App;
