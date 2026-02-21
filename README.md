# EV Charging Management System

Developed a comprehensive EV Charging infrastructure solution featuring a **Driver Portal**, a **Host Dashboard**, and a **Central Management System (CMS) Simulator**. The platform solves real-world EV charging challenges like late arrival penalties, session extensions, and real-time hardware-software timer synchronization.

## System Architecture

The project follows a **Triangular Interaction Model** to ensure data integrity between the user, the host, and the charging hardware.



1.  **Driver Portal (React):** Handles discovery, booking, and live session monitoring.
2.  **Backend (Spring Boot):** The "Brain" that manages billing, user state, and business logic.
3.  **CMS Simulator (Spring Boot):** Mimics physical charging hardware (OCPP-lite), handling the actual power flow and hardware state.

---

## Development Environment & Tools

| Component | Technology | IDE / Tool |
| :--- | :--- | :--- |
| **Frontend** | React.js (Vite) | **VS Code** |
| **Main Backend** | Spring Boot (Java) | **IntelliJ IDEA** |
| **CMS Simulator** | Spring Boot (Java) | **IntelliJ IDEA** |
| **Database** | PostgreSQL | **DBeaver** |

---

## API Reference

### 1. Main Backend APIs (Port 8080)
| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/chargers` | `GET` | Lists all chargers with live status (AVAILABLE/BOOKED/CHARGING). |
| `/api/bookings` | `POST` | Creates a booking and snapshots charger details (price, location). |
| `/api/bookings/{id}/verify-otp` | `POST` | Validates arrival and allows session start. |
| `/api/bookings/{id}/start` | `POST` | Triggers CMS Unblock and records `chargingStartedAt`. |
| `/api/bookings/{id}/extend` | `POST` | Adds time (15-min increments) to an active session. |
| `/api/bookings/{id}/stop` | `POST` | Sends stop signal to CMS and calculates final bill. |

### 2. CMS Simulator APIs (Port 9090)
| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/cms/chargers/{id}/block` | `POST` | Block the charger for a perticular booking, includes charging duration, charger id, location , etc.|
| `/api/cms/chargers/{id}/unblock` | `POST` | Unlocks hardware and starts the physical power meter. |
| `/api/cms/chargers/{id}/stop` | `POST` | Cuts power and sends final energy data to the main backend. And after stoping give the Time Stamp of the charging includes Total Energy Delivered in mins/hrs . |

---

## Hardware Interaction Workflow

### The Block/Unblock Mechanism
* **Initial State:** Chargers are "Blocked" (Locked) by default.
* **Unblock (Start):** When the Host clicks **Start**, the Backend sends a REST call to the CMS. The CMS hardware simulator "unlocks," allowing the user to plug in. 
* **Stop:** When the timer hits the limit or the user stops manually, the Backend triggers the CMS Stop API. The hardware immediately cuts the power and sends a summary (kWh and seconds) back to the Backend for the receipt.



---
## Database Logic (DBeaver/PostgreSQL)
We use a **Snapshot Strategy** in our `bookings` table. When a booking is made, we copy the charger's `brand`, `location`, and `type` into the booking record. This ensures that if a host changes their charger details later, the historical receipts remain accurate.

---

## Getting Started

1.  **Database:** Create a database named `karocharge` in PostgreSQL using **DBeaver**.
2.  **CMS:** Open the CMS project in **IntelliJ** and run it on port `9090`.
3.  **Backend:** Open the Main Backend in **IntelliJ**, update `application.properties` with your DB credentials, and run it on port `8080`.
4.  **Frontend:** Open in **VS Code**, run `npm install` followed by `npm run dev`.

---

© 2026 KaroCharge Team.
