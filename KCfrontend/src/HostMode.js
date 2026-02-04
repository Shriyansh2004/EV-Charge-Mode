import { useState, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { hostCharger, getChargers, getBookingsByCharger, cancelBooking, cancelSession, getChargerTimerStatus, markBookingPaid, getBookingTimerStatus } from "./api";

function HostMode({ sessionCost: completedSessionCost, cancelledSessionCost, refreshHostBookingsTrigger, refreshAllChargersTrigger, onConsumeRefreshTrigger, onConsumeAllChargersTrigger, bookingCountdownTimers, setBookingCountdownTimers }) {

  const EV_BRANDS = [
    "TATA",
    "Tesla",
    "Ather",
    "ChargeZone",
    "Statiq",
    "Zeon",
    "Fortum",
    "Okaya",
    "Delta",
    "Exicom",
    "ABB",
    "Siemens",
    "Magenta",
    "Relux",
    "Servotech",
    "E-Fill",
  ];

  const CONNECTOR_TYPES = [
    "Type 2",
    "CCS2",
    "CHAdeMO",
    "GB/T",
    "Type 1",
    "Bharat AC001",
    "Bharat DC001",
  ];

  const [myCharger, setMyCharger] = useState(null);
  const [chargerBookings, setChargerBookings] = useState([]);
  const [disabledBookings, setDisabledBookings] = useState(new Set());
  const [dismissedBookings, setDismissedBookings] = useState(new Set()); // Track bookings where buttons should be hidden
  const [sessionCost, setSessionCost] = useState(null); // Store cost data for cancelled sessions
  const [timersByCharger, setTimersByCharger] = useState({}); // chargerId -> { running, elapsedSeconds }
  const [bookingTimers, setBookingTimers] = useState({}); // bookingId -> timer status
  const [sessionCosts, setSessionCosts] = useState({}); // bookingId -> cost data (for cancelled in this tab)
  const [payingBookingId, setPayingBookingId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);

  // Load saved data on mount
  useEffect(() => {
    const savedCharger = localStorage.getItem('myCharger');
    const savedBookings = localStorage.getItem('chargerBookings');
    const savedDismissed = localStorage.getItem('dismissedBookings');
    const savedCancelledCost = localStorage.getItem('cancelledSessionCost');
    
    if (savedCharger) {
      setMyCharger(JSON.parse(savedCharger));
    }
    if (savedBookings) {
      setChargerBookings(JSON.parse(savedBookings));
    }
    if (savedDismissed) {
      try {
        const dismissedArray = JSON.parse(savedDismissed);
        setDismissedBookings(new Set(dismissedArray));
      } catch (e) {
        console.error('Error loading dismissed bookings:', e);
      }
    }
    if (savedCancelledCost) {
      try {
        setSessionCost(JSON.parse(savedCancelledCost));
      } catch (e) {
        console.error('Error loading cancelled session cost:', e);
      }
    }
  }, []);

  // Update session cost when prop changes (cancelled takes precedence for the legacy summary box)
  useEffect(() => {
    if (cancelledSessionCost) {
      setSessionCost(cancelledSessionCost);
      localStorage.setItem('cancelledSessionCost', JSON.stringify(cancelledSessionCost));
    }
  }, [cancelledSessionCost]);

  // When host just completed/cancelled in App, refresh charger bookings so we get sessionCost & paymentStatus from backend
  useEffect(() => {
    if (!refreshHostBookingsTrigger || !myCharger || !onConsumeRefreshTrigger) return;
    let cancelled = false;
    (async () => {
      await refreshChargerStatus();
      if (!cancelled) onConsumeRefreshTrigger();
    })();
    return () => { cancelled = true; };
  }, [refreshHostBookingsTrigger, myCharger, onConsumeRefreshTrigger]);

  // When any cancellation happens (driver or host), refresh myCharger to update totalEnergy
  useEffect(() => {
    if (!refreshAllChargersTrigger || !myCharger || !onConsumeAllChargersTrigger) return;
    let cancelled = false;
    (async () => {
      await refreshChargerStatus();
      if (!cancelled) onConsumeAllChargersTrigger();
    })();
    return () => { cancelled = true; };
  }, [refreshAllChargersTrigger, myCharger, onConsumeAllChargersTrigger]);

  // Poll to update payment status when driver pays (any booking with pending payment)
  const pendingPaymentKey = chargerBookings
    .filter((b) => b.sessionCost)
    .map((b) => `${b.bookingId}:${b.paymentStatus || ""}`)
    .sort()
    .join("|");
  useEffect(() => {
    const hasPending = chargerBookings.some((b) => b.sessionCost && b.paymentStatus === "pending");
    if (!hasPending || !myCharger) return;
    const interval = setInterval(refreshChargerStatus, 6000);
    return () => clearInterval(interval);
  }, [pendingPaymentKey, myCharger?.chargerId]);

  // Save dismissed bookings to localStorage whenever it changes
  useEffect(() => {
    if (dismissedBookings.size > 0) {
      localStorage.setItem('dismissedBookings', JSON.stringify(Array.from(dismissedBookings)));
    }
  }, [dismissedBookings]);

  // Poll CMS for live timer for the hosted charger
  useEffect(() => {
    if (!myCharger) return;
    const pollTimer = async () => {
      try {
        const status = await getChargerTimerStatus(myCharger.chargerId);
        if (status && (status.running || status.completed)) {
          setTimersByCharger({ [myCharger.chargerId]: status });
        } else {
          setTimersByCharger({});
        }
      } catch (e) {
        // ignore
      }
    };

    // Poll immediately, then every second
    pollTimer();
    const interval = setInterval(pollTimer, 1000);

    return () => clearInterval(interval);
  }, [myCharger?.chargerId]);

  // Poll for booking timers
  useEffect(() => {
    if (!chargerBookings.length) return;
    const pollBookingTimers = async () => {
      const nextTimers = {};
      for (const booking of chargerBookings) {
        try {
          const status = await getBookingTimerStatus(booking.bookingId);
          if (status) {
            nextTimers[booking.bookingId] = status;

            // Show message when timer expires and late arrival detected
            const prevStatus = bookingTimers[booking.bookingId];
            if (prevStatus && prevStatus.remainingSeconds > 0 && status.remainingSeconds <= 0 && status.lateArrival) {
              alert("🚨 Late Arrival Detected! The EV driver has not arrived on time. A late fee will be charged each minute until the session starts.");
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
  }, [chargerBookings, bookingTimers]);


  // Show late fee notification when booking countdown timer expires
  useEffect(() => {
    if (myCharger) {
      const timer = bookingCountdownTimers[myCharger.chargerId];
      if (timer && timer.remainingSeconds === 0 && timer.running === false) {
        // Check if we haven't already shown the alert for this charger
        const alertKey = `lateFeeAlert_${myCharger.chargerId}`;
        if (!localStorage.getItem(alertKey)) {
          alert("🚨 Timer Expired! A late fee of ₹5 per minute will be charged to the EV driver until the session starts.");
          localStorage.setItem(alertKey, 'shown');
        }
      }
    }
  }, [bookingCountdownTimers, myCharger?.chargerId]);

  const [form, setForm] = useState({
    hostName: "",
    brand: "",
    connector: "",
    location: "",
    date: "",
    start_Time: "",
    slotDuration: "",
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setForm(prev => ({ ...prev, location: `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}` }));
      },
      (error) => {
        alert("Error getting location: " + error.message);
      }
    );
  };

  const submit = async () => {
    for (let key in form) {
      if (!form[key]) {
        alert("Please fill all fields");
        return;
      }
    }

    try {
      const res = await hostCharger(form);

      if (!res || res.message?.includes("cannot")) {
        alert(res.message);
        return;
      }

      alert(res.message || "Charger hosted successfully");

      // Set the hosted charger for display
      setMyCharger(res.charger);
      localStorage.setItem('myCharger', JSON.stringify(res.charger));

      // Load bookings for this charger
      const bookings = await getBookingsByCharger(res.charger.chargerId);
      setChargerBookings(bookings);
      localStorage.setItem('chargerBookings', JSON.stringify(bookings));

      // Clear dismissed bookings for new charger (reset state for new booking)
      setDismissedBookings(new Set());
      localStorage.removeItem('dismissedBookings');

      setForm({
        hostName: "",
        brand: "",
        connector: "",
        location: "",
        date: "",
        start_Time: "",
        slotDuration: "",
      });
      setSelectedDate(null);
      setSelectedTime('10:00');

    } catch (err) {
      alert("❌ Invalid date or time. Please select a future slot.");
    }
  };

  const refreshChargerStatus = async () => {
    try {
      const updatedChargers = await getChargers();
      const updatedCharger = updatedChargers.find(c => c.chargerId === myCharger.chargerId);
      if (updatedCharger) {
        setMyCharger(updatedCharger);
        localStorage.setItem('myCharger', JSON.stringify(updatedCharger));
        const bookings = await getBookingsByCharger(updatedCharger.chargerId);
        setChargerBookings(bookings);
        localStorage.setItem('chargerBookings', JSON.stringify(bookings));
      }
    } catch (error) {
      console.error('Error refreshing charger status:', error);
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
        // Refresh bookings
        const bookings = await getBookingsByCharger(myCharger.chargerId);
        setChargerBookings(bookings);
        localStorage.setItem('chargerBookings', JSON.stringify(bookings));
        // Refresh charger status
        refreshChargerStatus();
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



  return (
    <div
      style={{
        border: "1px solid #ccc",
        padding: 20,
        maxWidth: 400,
        backgroundColor: "#e8f5e9"
      }}
    >
      <h2>Host Mode – Add Charger</h2>

      {/* 🔹 CHANGED ONLY THIS RENDER PART */}
      {Object.keys(form).map((key) => (
        <div key={key} style={{ marginBottom: 10 }}>

          {key === "brand" ? (
            <>
              <input
                list="brandList"
                type="text"
                name="brand"
                placeholder="brand"
                value={form.brand}
                onChange={handleChange}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #999",
                  borderRadius: 4,
                  backgroundColor: "#fffde7"
                }}
              />
              <datalist id="brandList">
                {EV_BRANDS.map((b, i) => (
                  <option key={i} value={b} />
                ))}
              </datalist>
            </>
          ) : key === "connector" ? (
            <>
              <input
                list="connectorList"
                type="text"
                name="connector"
                placeholder="connector"
                value={form.connector}
                onChange={handleChange}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #999",
                  borderRadius: 4,
                  backgroundColor: "#fffde7"
                }}
              />
              <datalist id="connectorList">
                {CONNECTOR_TYPES.map((c, i) => (
                  <option key={i} value={c} />
                ))}
              </datalist>
            </>
          ) : key === "date" ? (
            <div style={{
              width: "100%",
              padding: "10px",
              border: "1px solid #999",
              borderRadius: 4,
              backgroundColor: "#fffde7"
            }}>
              <DatePicker
                selected={selectedDate}
                onChange={(date) => {
                  setSelectedDate(date);
                  setForm({
                    ...form,
                    date: date ? `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}` : ""
                  });
                }}
                dateFormat="dd/MM/yyyy"
                placeholderText="Select date"
              />
            </div>
          ) : key === "start_Time" ? (
            <input
              type="time"
              name="start_Time"
              value={selectedTime || ""}
              onChange={(e) => {
                setSelectedTime(e.target.value);
                setForm({
                  ...form,
                  start_Time: e.target.value
                });
              }}
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #999",
                borderRadius: 4,
                backgroundColor: "#fffde7"
              }}
            />
          ) : key === "location" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="text"
                name={key}
                placeholder={key}
                value={form[key]}
                onChange={handleChange}
                style={{
                  flex: 1,
                  padding: "10px",
                  border: "1px solid #999",
                  borderRadius: 4,
                  backgroundColor: "#fffde7"
                }}
              />
              <button
                type="button"
                onClick={getCurrentLocation}
                style={{
                  padding: "10px",
                  backgroundColor: "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: "14px"
                }}
                title="Get Current Location"
              >
                📍
              </button>
            </div>
          ) : (
            <input
              type="text"
              name={key}
              placeholder={key}
              value={form[key]}
              onChange={handleChange}
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #999",
                borderRadius: 4,
                backgroundColor: "#fffde7"
              }}
            />
          )}

        </div>
      ))}

      <button
        onClick={submit}
        style={{
          backgroundColor: "#ffeb3b",
          color: "#000",
          border: "none",
          padding: "10px",
          fontWeight: "bold",
          cursor: "pointer",
          width: "100%"
        }}
      >
        Host Charger
      </button>

      {/* 🔹 NEW: Display hosted charger */}
      {myCharger && (
        <div style={{ marginTop: 20, padding: 15, backgroundColor: "#fff3e0", borderRadius: 8 }}>
          <h3>My Charger Slot</h3>
          <p><strong>Charger ID:</strong> {myCharger.chargerId}</p>
          <p><strong>Host Name:</strong> {myCharger.hostName}</p>
          <p><strong>Brand:</strong> {myCharger.brand}</p>
          <p><strong>Connector:</strong> {myCharger.connector}</p>
          <p><strong>Location:</strong> {myCharger.location}</p>
          <p><strong>Date:</strong> {myCharger.date}</p>
          <p><strong>Start Time:</strong> {myCharger.start_Time}</p>
          <p><strong>Duration:</strong> {myCharger.slotDuration} Hours</p>
          <p><strong>Status:</strong> <span style={{ color: myCharger.status === "AVAILABLE" ? "green" : "red" }}>{myCharger.status}</span></p>
          <p><strong>Total Energy Delivered:</strong> {myCharger.totalEnergy} kWh</p>

          {/* Booking Countdown Timer */}
          {myCharger.status === "BOOKED" && bookingCountdownTimers[myCharger.chargerId] && bookingCountdownTimers[myCharger.chargerId].running && (
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
                {new Date((bookingCountdownTimers[myCharger.chargerId].remainingSeconds || 0) * 1000).toISOString().substr(14, 5)}
              </p>
            </div>
          )}

          <button
            onClick={refreshChargerStatus}
            style={{
              backgroundColor: "#ffeb3b",
              color: "#000",
              border: "none",
              padding: "10px",
              fontWeight: "bold",
              cursor: "pointer",
              width: "100%",
              marginTop: 10
            }}
          >
            Refresh Status
          </button>



          {/* Display bookings */}
          {chargerBookings.length > 0 && (
            <div style={{ marginTop: 15 }}>
              <h4>Bookings:</h4>
              {chargerBookings.map((booking, index) => (
                <div key={index} style={{ marginBottom: 10, padding: 10, backgroundColor: "#f9f9f9", borderRadius: 4 }}>
                  <p><strong>Booking ID:</strong> {booking.bookingId}</p>
                  <p><strong>Date:</strong> {booking.date}</p>
                  <p><strong>Start Time:</strong> {booking.start_Time}</p>
                  <p><strong>Duration:</strong> {booking.slotDuration}</p>
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

                  

                  {/* Cost summary & Make payment (completed or cancelled session) */}
                  {(() => {
                    const cost = sessionCosts[booking.bookingId] || booking.sessionCost;
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
                              {cost.earlyCancellationFee < 0 && " (Host cancelled)"}
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
                        <hr style={{ margin: "8px 0", borderColor: "#ffcc80" }} />
                        <h5 style={{ margin: "0 0 10px 0", color: "#e65100" }}>Host Cost Summary</h5>
                        {(() => {
                          if (cost.cancelledBy === "HOST") {
                            return (
                              <div>
                                <p style={{ margin: "4px 0", color: "#d32f2f" }}><strong>Cancellation Fee:</strong> ₹{Math.abs(cost.earlyCancellationFee).toFixed(2)}</p>
                                <p style={{ margin: "8px 0 0 0", fontSize: 16, fontWeight: "bold", color: "#d32f2f" }}>
                                  <strong>Total Host Cost:</strong> ₹{Math.abs(cost.earlyCancellationFee).toFixed(2)}
                                </p>
                                <button
                                  disabled={payingBookingId === booking.bookingId}
                                  onClick={async () => {
                                    setPayingBookingId(booking.bookingId);
                                    try {
                                      await markBookingPaid(booking.bookingId);
                                      // Refresh bookings to update payment status
                                      const bookings = await getBookingsByCharger(myCharger.chargerId);
                                      setChargerBookings(bookings);
                                      localStorage.setItem('chargerBookings', JSON.stringify(bookings));
                                    } catch (e) {
                                      alert("Payment failed: " + (e.message || "Unknown error"));
                                    } finally {
                                      setPayingBookingId(null);
                                    }
                                  }}
                                  style={{
                                    marginTop: 8,
                                    padding: "8px 16px",
                                    backgroundColor: payingBookingId === booking.bookingId ? "#9e9e9e" : "#4caf50",
                                    color: "white",
                                    border: "none",
                                    borderRadius: 6,
                                    cursor: payingBookingId === booking.bookingId ? "wait" : "pointer",
                                    fontWeight: "bold",
                                    fontSize: 14
                                  }}
                                >
                                  {payingBookingId === booking.bookingId ? "Processing…" : "Pay Driver"}
                                </button>
                              </div>
                            );
  } else {
    return null;
  }
                        })()}
                      </div>
                    );
                  })()}

                  {/* Amount you receive & payment status (completed or cancelled session) */}
                  {booking.sessionCost && (
                    <div style={{ marginTop: 8, padding: 8, backgroundColor: "#e8f5e9", borderRadius: 4, border: "1px solid #4caf50" }}>
                      <p style={{ margin: "0 0 4px 0", fontWeight: "bold", color: "#2e7d32" }}>
                        Amount receive: ₹{typeof booking.sessionCost.total === "number" ? booking.sessionCost.total.toFixed(2) : "0.00"}
                      </p>
                      <p style={{ margin: 0, fontSize: 14, color: booking.paymentStatus === "paid" ? "#2e7d32" : "#f57c00" }}>
                        {booking.paymentStatus === "paid" ? "✓ Payment received" : "⏳ Payment pending"}
                      </p>
                    </div>
                  )}

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
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}


    </div>
  );
}

export default HostMode;
