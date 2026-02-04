const BASE_URL = "http://localhost:5000/api";

export const hostCharger = async (data) => {
  const res = await fetch(`${BASE_URL}/host`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return res.json();
};

export const getChargers = async () => {
  const res = await fetch(`${BASE_URL}/chargers`);
  return res.json();
};

export const bookCharger = async (data) => {
  const res = await fetch(`${BASE_URL}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return res.json();
};

export const requestOtp = async (bookingId) => {
  const res = await fetch(`${BASE_URL}/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  return res.json();
};

export const verifyOtp = async (bookingId, otp) => {
  const res = await fetch(`${BASE_URL}/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, otp })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to verify OTP");
  }
  return data;
};

export const startSession = async (bookingId) => {
  const res = await fetch(`${BASE_URL}/start-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Failed to start session");
  }
  return data;
};

export const completeSession = async (bookingId, nextBooking) => {
  const res = await fetch("http://localhost:5000/api/complete-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, nextBooking })
  });
  return res.json();
};

export const autoCompleteSession = async (bookingId) => {
  const res = await fetch("http://localhost:5000/api/session/auto-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  return res.json();
};

export const extendSession = async (bookingId, newDuration, newDate, newStartTime) => {
  const res = await fetch("http://localhost:5000/api/session/extend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, newDuration, newDate, newStartTime })
  });
  return res.json();
};

export const getBookingsByCharger = async (chargerId) => {
  const res = await fetch(`${BASE_URL}/bookings/${chargerId}`);
  return res.json();
};

export const cancelBooking = async (bookingId) => {
  const res = await fetch(`${BASE_URL}/cancel-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  return res.json();
};

export const cancelSession = async (bookingId, cancelledBy) => {
  const res = await fetch(`${BASE_URL}/cancel-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, cancelledBy })
  });
  return res.json();
};

export const getChargerTimerStatus = async (chargerId) => {
  const res = await fetch(`http://localhost:3001/api/charger/${chargerId}/timer-status`);
  return res.json();
};

export const getBooking = async (bookingId) => {
  const res = await fetch(`${BASE_URL}/booking/${bookingId}`);
  return res.json();
};

export const markBookingPaid = async (bookingId) => {
  const res = await fetch(`${BASE_URL}/booking/${bookingId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to record payment");
  return data;
};

export const getBookingTimerStatus = async (bookingId) => {
  const res = await fetch(`${BASE_URL}/booking/timer/${bookingId}`);
  return res.json();
};
