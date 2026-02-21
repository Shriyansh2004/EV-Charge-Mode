import { useState, useEffect } from "react";
import API from "../services/api";
import "./HostMode.css";

function HostMode() {
  const [formData, setFormData] = useState({
    hostName: "", location: "", brand: "", type: "AC",
    availableDate: "", startTime: "", duration: "", status: "AVAILABLE"
  });

  const [myChargers, setMyChargers] = useState([]);
  const [bookingId, setBookingId] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [timer, setTimer] = useState(0);
  const [sessionSummary, setSessionSummary] = useState(null);
  const [dateError, setDateError] = useState("");

  // --- KAROCHARGE BILLING ENGINE ---
  const calculateKaroCost = (session) => {
    const EFFICIENCY = session.type === "DC" ? 0.95 : 0.90;
    const BASE_TARIFF = 15;
    const BOOKING_RATE = 10;
    const CANCEL_RATE = 25;
    const LATE_RATE = 5; 
    const IDLE_RATE = 5;
    const GST_RATE = 0.18;

    const energyUsed = session.totalEnergy || 0;
    const energyCost = (energyUsed / EFFICIENCY) * BASE_TARIFF;

    const bookedHrs = session.bookedDuration || 0;
    const bookingFee = bookedHrs * BOOKING_RATE;

    const lateMins = session.lateMinutes || 0;
    const lateFee = lateMins * LATE_RATE; 
    
    const idleMins = session.idleMinutes || 0;
    const idleFee = idleMins > 5 ? (idleMins - 5) * IDLE_RATE : 0;

    let cancelAdjustment = 0;
    if (session.cancelledBy) {
      const bookedMins = bookedHrs * 60;
      const actualMins = (session.actualDuration || 0) / 60;
      const unusedMins = Math.max(0, bookedMins - actualMins);
      const rawCancelFee = (unusedMins / 60) * CANCEL_RATE;
      cancelAdjustment = session.cancelledBy === "DRIVER" ? rawCancelFee : -rawCancelFee;
    }

    const subtotal = energyCost + bookingFee + lateFee + idleFee + cancelAdjustment;
    const taxes = subtotal * GST_RATE;
    const total = subtotal + taxes;

    return { 
        energyCost: energyCost.toFixed(2), 
        bookingFee: bookingFee.toFixed(2), 
        lateFee: lateFee.toFixed(2),
        idleFee: idleFee.toFixed(2),
        cancelAdjustment: cancelAdjustment.toFixed(2), 
        subtotal: subtotal.toFixed(2),
        taxes: taxes.toFixed(2), 
        total: total.toFixed(2) 
    };
  };

  // Local Ticker for smoothness
  useEffect(() => {
    let interval = null;
    if (isCharging) {
      interval = setInterval(() => setTimer((prev) => prev + 1), 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isCharging]);

  // --- SYNC POLLING LOGIC ---
  useEffect(() => {
    let pollInterval;
    if (bookingId) {
      pollInterval = setInterval(async () => {
        try {
          const res = await API.get(`/api/bookings/${bookingId}`);
          const serverStatus = res.data.status;

          // 1. SYNC TIMER: Force Host timer to match Server truth
          if (serverStatus === "CHARGING") {
            setIsCharging(true);
            setSessionSummary(null); // Hide summary if session was extended
            if (res.data.actualDuration !== undefined) {
                setTimer(res.data.actualDuration);
            }
          }

          // 2. DETECT STOP (Manual or Auto-Stop)
          if (serverStatus === "COMPLETED" || serverStatus === "CANCELLED") {
            setIsCharging(false);
            setSessionSummary(res.data);
            setOtpVerified(false);
            if (formData.hostName) fetchMyChargers(formData.hostName);
          }
        } catch (err) { console.error("Host Sync Error"); }
      }, 2000);
    }
    return () => clearInterval(pollInterval);
  }, [bookingId, formData.hostName]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (dateError) setDateError("");
  };

  const fetchMyChargers = async (hostName) => {
    if (!hostName) return;
    try {
      const res = await API.get(`/api/chargers/host/${hostName}`);
      setMyChargers(res.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { if (formData.hostName) fetchMyChargers(formData.hostName); }, [formData.hostName]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const selectedDateTime = new Date(`${formData.availableDate}T${formData.startTime}`);
    if (selectedDateTime < new Date()) {
      setDateError("❌ Error: Past date/time selected.");
      return;
    }
    try {
      await API.post("/api/chargers", formData);
      alert("Charger Hosted!");
      fetchMyChargers(formData.hostName);
    } catch (error) { alert("Error hosting"); }
  };

  const handleVerifyOtp = async () => {
    try {
      const res = await API.post(`/api/bookings/${bookingId}/verify-otp`, null, { params: { otp: otpInput } });
      if (res.status === 200) setOtpVerified(true);
    } catch (err) { alert("Invalid OTP"); }
  };

  const handleStartSession = async () => {
    try {
      await API.post(`/api/bookings/${bookingId}/start`);
      setIsCharging(true);
      setTimer(0);
      setSessionSummary(null);
    } catch (err) { alert("Start failed"); }
  };

  const handleCompleteSession = async () => {
    if(!window.confirm("End Session normally?")) return;
    try {
      await API.post(`/api/bookings/${bookingId}/stop`);
    } catch (err) { alert("Stop failed"); }
  };

  const handleCancelSession = async () => {
    if (!window.confirm("⚠️ HOST CANCEL? Compensation discount will apply.")) return;
    try {
      await API.post(`/api/bookings/${bookingId}/stop`, null, { params: { cancelledBy: "HOST" } });
    } catch (err) { alert("Cancel failed"); }
  };

  const formatTime = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <div className="host-container">
      <div className="host-dashboard-wrapper">
        <div className="host-side-panel">
          <form className="host-form" onSubmit={handleSubmit}>
            <h2>Host Charger</h2>
            <input type="text" name="hostName" placeholder="Your Name" value={formData.hostName} onChange={handleChange} required />
            <input type="text" name="location" placeholder="Location" value={formData.location} onChange={handleChange} required />
            <div className="form-row">
                <input type="text" name="brand" placeholder="Brand" value={formData.brand} onChange={handleChange} required />
                <select name="type" value={formData.type} onChange={handleChange} className="search-input" style={{marginBottom: '12px'}}>
                    <option value="AC">AC</option>
                    <option value="DC">DC</option>
                </select>
            </div>
            <div className="form-row">
              <input type="date" name="availableDate" value={formData.availableDate} onChange={handleChange} required />
              <input type="time" name="startTime" value={formData.startTime} onChange={handleChange} required />
            </div>
            <input type="number" name="duration" placeholder="Hours Available" value={formData.duration} onChange={handleChange} required />
            {dateError && <div className="error-message">{dateError}</div>}
            <button type="submit" className="host-btn">List Charger</button>
          </form>

          <div className="host-list-card">
            <h3>My Assets</h3>
            <div className="mini-list">
              {myChargers.map(c => (
                <div key={c.id} className="mini-item">
                  <span>#{c.id} {c.brand} ({c.type})</span>
                  <span className={`status-tag ${c.status.toLowerCase()}`}>{c.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="host-main-panel">
          <div className="session-card">
            <h3>Session Control</h3>
            {isCharging ? (
              <div className="live-view">
                <div className="bolt-icon-host">⚡</div>
                <h1 className="timer-text">{formatTime(timer)}</h1>
                <div className="button-group-row">
                  <button onClick={handleCompleteSession} className="stop-btn">STOP</button>
                  <button onClick={handleCancelSession} className="cancel-btn">CANCEL</button>
                </div>
              </div>
            ) : sessionSummary ? (
              <div className="summary-view">
                 <div className="summary-box-host">
                    <h2 style={{color: '#f1c40f'}}>SUMMARY</h2>
                    {(() => {
                        const bill = calculateKaroCost(sessionSummary);
                        return (
                          <div className="summary-stats">
                             <div className="summary-row"><span>Energy Cost</span> <span>₹{bill.energyCost}</span></div>
                             <div className="summary-row"><span>Booking Fee</span> <span>₹{bill.bookingFee}</span></div>
                             {parseFloat(bill.lateFee) > 0 && <div className="summary-row" style={{color: '#ff9f43'}}><span>Late Arrival Fee</span> <span>+₹{bill.lateFee}</span></div>}
                             {parseFloat(bill.cancelAdjustment) !== 0 && (
                                <div className="summary-row" style={{color: bill.cancelAdjustment > 0 ? '#ff4757' : '#2ecc71', fontWeight: 'bold'}}>
                                    <span>{sessionSummary.cancelledBy === "DRIVER" ? "Early Cancel Fee" : "Cancel Discount"}</span> 
                                    <span>{parseFloat(bill.cancelAdjustment) > 0 ? "+" : ""}₹{bill.cancelAdjustment}</span>
                                </div>
                             )}
                             <hr />
                             <div className="summary-row" style={{fontSize: '1.8rem', color: '#f1c40f', fontWeight: 'bold'}}>
                                <span>TOTAL</span> <span>₹{bill.total}</span>
                             </div>
                          </div>
                        );
                    })()}
                 </div>
                 <button className="host-btn" onClick={() => {
                     setSessionSummary(null);
                     setBookingId("");
                     setOtpInput("");
                 }}>DONE</button>
              </div>
            ) : (
              <div className="entry-view">
                <div className="input-group">
                  <input type="number" placeholder="Booking ID" value={bookingId} onChange={(e) => setBookingId(e.target.value)} disabled={otpVerified} />
                  <input type="text" placeholder="Enter OTP" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} disabled={otpVerified} />
                </div>
                {!otpVerified ? (
                  <button onClick={handleVerifyOtp} className="verify-btn">Verify OTP</button>
                ) : (
                  <div className="verified-area">
                    <button onClick={handleStartSession} className="start-btn">🚀 START SESSION</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HostMode;