import { useEffect, useState } from "react";
import "./ChargeMode.css";
import API from "../services/api";

function ChargeMode() {
  const [chargers, setChargers] = useState([]);
  const [search, setSearch] = useState("");
  const [bookingId, setBookingId] = useState(null);
  const [bookingStatus, setBookingStatus] = useState(null);
  
  const [selectedChargerId, setSelectedChargerId] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(30); 

  const [sessionTimer, setSessionTimer] = useState(0);
  const [finalSummary, setFinalSummary] = useState(null);
  const [arrivalTimeLeft, setArrivalTimeLeft] = useState(null);
  const [arrivalChargerId, setArrivalChargerId] = useState(null);
  const [isLate, setIsLate] = useState(false); 
  const [reachedBookingId, setReachedBookingId] = useState(null);
  const [otp, setOtp] = useState(null);

  const fetchChargers = async () => {
    try {
      const res = await API.get("/api/chargers");
      setChargers(res.data || []);
    } catch (err) { console.error("Fetch error:", err); }
  };

  useEffect(() => { fetchChargers(); }, []);

  // --- AUTO-STOP LOGIC ---
  useEffect(() => {
    const limitInSeconds = selectedDuration * 60;
    if (bookingStatus === "CHARGING" && sessionTimer >= limitInSeconds) {
      console.log("Time limit reached. Auto-stopping session...");
      triggerStopApi();
    }
  }, [sessionTimer, bookingStatus, selectedDuration]);

  const triggerStopApi = async () => {
    try {
      await API.post(`/api/bookings/${bookingId}/stop`);
    } catch (err) { console.error("Auto-stop API failed"); }
  };

  // --- EXTEND SESSION LOGIC ---
  const handleExtendSession = async () => {
    try {
      const res = await API.post(`/api/bookings/${bookingId}/extend`, null, { 
        params: { extraMinutes: 15 } 
      });
      
      if (res.status === 200) {
        setSelectedDuration(prev => prev + 15); 
        setFinalSummary(null); 
        setBookingStatus("CHARGING"); 
        alert("Session extended by 15 minutes!");
      }
    } catch (err) {
      alert("Extension failed. The charger might be booked by someone else.");
    }
  };

  const calculateFinalBill = (summary) => {
    const { energy, duration, chargerType, lateMinutes = 0, idleMinutes = 0, cancelledBy, bookedDurationHours } = summary;
    
    const baseTariff = 15;
    const bookingFeeHr = 10;
    const earlyCancelRate = 25;
    const idleFeeMin = 5;
    const lateFeeMin = 5; 
    const efficiency = chargerType === "DC" ? 0.95 : 0.9;
    const gstRate = 0.18;

    const energyCost = (energy / efficiency) * baseTariff;
    const billedHours = bookedDurationHours || (selectedDuration / 60);
    const bookingFee = billedHours * bookingFeeHr;

    const latePenalty = (lateMinutes || 0) * lateFeeMin;
    const idlePenalty = idleMinutes > 5 ? (idleMinutes - 5) * idleFeeMin : 0;

    let cancelAdjustment = 0;
    if (cancelledBy) {
      const bookedMins = billedHours * 60;
      const actualMins = (duration || 0) / 60;
      const unusedMins = Math.max(0, bookedMins - actualMins);
      const rawCancelFee = (unusedMins / 60) * earlyCancelRate;
      cancelAdjustment = cancelledBy === "DRIVER" ? rawCancelFee : -rawCancelFee;
    }

    const subtotal = energyCost + bookingFee + latePenalty + idlePenalty + cancelAdjustment;
    const taxes = subtotal * gstRate;
    const total = subtotal + taxes;

    return {
      energyCost: energyCost.toFixed(2),
      bookingFee: bookingFee.toFixed(2),
      latePenalty: latePenalty.toFixed(2),
      idlePenalty: idlePenalty.toFixed(2),
      cancelAdj: cancelAdjustment.toFixed(2),
      taxes: taxes.toFixed(2),
      total: total.toFixed(2)
    };
  };

  const handleConfirmBooking = async () => {
    try {
      const res = await API.post(`/api/bookings`, { 
          charger: { id: selectedChargerId }, 
          userName: "EV DRIVER 1", 
          duration: selectedDuration 
      });
      
      if (res.data) {
        setBookingId(res.data.id);
        setBookingStatus(res.data.status); 
        setIsLate(false);
        setSessionTimer(0); 
        startArrivalTimer(selectedChargerId);
        setSelectedChargerId(null); 
        fetchChargers();
      }
    } catch (err) { alert("Booking failed."); }
  };

  const startArrivalTimer = (chargerId) => {
    setArrivalChargerId(chargerId);
    setArrivalTimeLeft(60); 
    const interval = setInterval(() => {
      setArrivalTimeLeft((prev) => {
        if (prev <= 1) { 
          clearInterval(interval); 
          setIsLate(true); 
          return 0; 
        }
        return prev - 1;
      });
    }, 1000);
  };

  // --- TIMER SYNC LOGIC (The Fix) ---
  useEffect(() => {
    let pollInterval;
    if (bookingId && !finalSummary) {
      pollInterval = setInterval(async () => {
        try {
          const res = await API.get(`/api/bookings/${bookingId}`);
          const newStatus = res.data.status;
          setBookingStatus(newStatus); 
          
          // SYNC: If charging, force the local timer to match the server's duration
          // This fixes the 30s vs 60s mismatch
          if (newStatus === "CHARGING" && res.data.actualDuration !== undefined) {
              setSessionTimer(res.data.actualDuration);
          }
          
          if (newStatus === "COMPLETED" || newStatus === "CANCELLED") {
            setFinalSummary({
              energy: res.data.totalEnergy,
              duration: res.data.actualDuration, 
              bookedDurationHours: res.data.bookedDuration, 
              chargerType: res.data.charger?.type || "AC",
              lateMinutes: res.data.lateMinutes || 0,
              idleMinutes: res.data.idleMinutes || 0,
              cancelledBy: res.data.cancelledBy || null
            });
            clearInterval(pollInterval);
          }
        } catch (err) { console.error("Polling..."); }
      }, 2000); // Polls every 2 seconds
    }
    return () => clearInterval(pollInterval);
  }, [bookingId, finalSummary]);

  // Local ticker for smooth 1-second updates between polls
  useEffect(() => {
    let timer;
    if (bookingStatus === "CHARGING") {
      timer = setInterval(() => setSessionTimer(p => p + 1), 1000);
    } else {
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [bookingStatus]);

  const handleStopSession = async () => {
    if (!window.confirm("Stop charging?")) return;
    triggerStopApi();
  };

  const handleCancelByGuest = async () => {
    if (!window.confirm("⚠️ CANCEL SESSION? Early cancellation fees may apply.")) return;
    try {
      await API.post(`/api/bookings/${bookingId}/stop`, null, { 
        params: { cancelledBy: "DRIVER" } 
      });
      fetchChargers();
    } catch (err) { alert("Cancellation failed."); }
  };

  const formatTime = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <div className="charge-container">
      <h1>EV CHARGING PORTAL</h1>

      {bookingStatus === "CHARGING" && !finalSummary && (
        <div className="charging-overlay">
          <div className="charging-card">
            <div className="bolt-icon">⚡</div>
            <h2 style={{letterSpacing: '2px', color: '#fff', margin: '10px 0'}}>SESSION ACTIVE</h2>
            <div className="live-stats">
              <h1 className="timer-yellow">{formatTime(sessionTimer)}</h1>
              <p style={{fontSize: '0.9rem', color: '#f1c40f', marginBottom: '10px'}}>
                AUTO-STOP AT: {selectedDuration} MINS
              </p>
              <p style={{fontSize: '1.4rem', color: '#bdc3c7'}}>
                DELIVERED: <b style={{color: '#2ecc71'}}>{(sessionTimer * 0.01).toFixed(2)} kWh</b>
              </p>
            </div>
            <div style={{display: 'flex', gap: '15px', width: '100%', marginTop: '20px'}}>
                <button className="stop-btn-user" style={{flex: 1}} onClick={handleStopSession}>STOP</button>
                <button className="cancel-btn-guest" style={{flex: 1}} onClick={handleCancelByGuest}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {finalSummary && (
        <div className="charging-overlay">
          <div className="summary-card" style={{border: '2px solid #f1c40f', maxWidth: '450px'}}>
            <h2 style={{color: '#f1c40f', fontSize: '2rem'}}>RECEIPT</h2>
            {(() => {
                const bill = calculateFinalBill(finalSummary);
                return (
                  <div className="bill-details" style={{textAlign: 'left', margin: '20px 0'}}>
                    <div className="bill-row"><span>Energy Cost</span> <span>₹{bill.energyCost}</span></div>
                    <div className="bill-row"><span>Booking Fee</span> <span>₹{bill.bookingFee}</span></div>
                    {parseFloat(bill.latePenalty) > 0 && <div className="bill-row" style={{color: '#ff9f43'}}><span>Late Arrival Fee</span> <span>+₹{bill.latePenalty}</span></div>}
                    {parseFloat(bill.cancelAdj) !== 0 && (
                        <div className="bill-row" style={{color: parseFloat(bill.cancelAdj) > 0 ? '#ff4757' : '#2ecc71', fontWeight: 'bold'}}>
                            <span>{finalSummary.cancelledBy === "DRIVER" ? "Early Cancel Penalty" : "Host Discount"}</span> 
                            <span>{parseFloat(bill.cancelAdj) > 0 ? "+" : ""}₹{bill.cancelAdj}</span>
                        </div>
                    )}
                    <div className="bill-row"><span>GST (18%)</span> <span>₹{bill.taxes}</span></div>
                    <hr style={{borderColor: '#444', margin: '15px 0'}} />
                    <div className="bill-row" style={{fontSize: '1.8rem', fontWeight: 'bold', color: '#f1c40f'}}>
                        <span>TOTAL</span> <span>₹{bill.total}</span>
                    </div>
                  </div>
                );
            })()}
            
            <div style={{display: 'flex', gap: '10px', width: '100%'}}>
                <button className="book-btn" style={{flex: 1, background: '#9b59b6'}} onClick={handleExtendSession}>EXTEND (+15m)</button>
                <button className="book-btn" style={{flex: 1}} onClick={() => window.location.reload()}>DONE</button>
            </div>
          </div>
        </div>
      )}

      <input className="search-input" placeholder="🔍 Search location or host..." onChange={(e) => setSearch(e.target.value)} />

      <div className="charger-list">
        {chargers.filter(c => c.location?.toLowerCase().includes(search.toLowerCase())).map((charger) => (
          <div key={charger.id} className="charger-card">
            <div>
                <h3>{charger.brand}</h3>
                <div className="status-badge">
                    <span className={charger.status === 'AVAILABLE' ? 'available' : 'booked'}>● {charger.status}</span>
                </div>
                <p style={{color: '#555', fontSize: '0.9rem'}}>📍 {charger.location} ({charger.type})</p>
            </div>
            <div className="card-actions">
                {charger.status === "AVAILABLE" && !bookingId && selectedChargerId !== charger.id && (
                  <button className="book-btn" onClick={() => setSelectedChargerId(charger.id)}>Book Now</button>
                )}
                {selectedChargerId === charger.id && (
                  <div className="booking-controls">
                    <p>SELECT CHARGING DURATION</p>
                    <select className="search-input" value={selectedDuration} onChange={(e) => setSelectedDuration(Number(e.target.value))}>
                      <option value={1}>1 min (Test)</option>
                      <option value={15}>15 mins</option>
                      <option value={30}>30 mins</option>
                      <option value={60}>60 mins</option>
                    </select>
                    <button className="book-btn" onClick={handleConfirmBooking}>Confirm</button>
                  </div>
                )}

                {arrivalChargerId === charger.id && (
                  <div className="timer-box">
                    {isLate ? (
                        <div className="late-warning" style={{color: '#ff4757', fontWeight: 'bold', marginBottom: '10px'}}>
                            ⚠️ Late arrival fee will be added each min ₹5
                        </div>
                    ) : (
                        <p>⏳ Time to reach: {arrivalTimeLeft}s</p>
                    )}
                    <button className="book-btn" style={{background:'#27ae60'}} onClick={() => { setArrivalChargerId(null); setReachedBookingId(bookingId); }}>I HAVE REACHED</button>
                  </div>
                )}

                {reachedBookingId === bookingId && bookingId && charger.status === "BOOKED" && (
                  <div className="otp-section">
                    {!otp ? (
                      <button className="book-btn" style={{background:'#e67e22'}} onClick={async () => {
                        const res = await API.post(`/api/bookings/${bookingId}/generate-otp`);
                        setOtp(res.data);
                      }}>REQUEST OTP</button>
                    ) : (
                      <div className="otp-display">
                        <span>GIVE TO HOST:</span>
                        <div className="otp-number">{otp}</div>
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ChargeMode;