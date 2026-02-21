package com.karocharge.backend.model;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "bookings")
public class Booking {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "charger_id", nullable = false)
    private Charger charger;

    /** * THE FIX: This is the exact moment the hardware unblocked.
     * Used by the controller to calculate 'actualDuration' live for the frontend.
     */
    private LocalDateTime chargingStartedAt;

    // --- SNAPSHOT FIELDS (Preserves data even if Charger is updated later) ---
    @Column(nullable = false)
    private String brand;
    @Column(nullable = false)
    private String type;
    @Column(nullable = false)
    private String hostName;
    @Column(nullable = false)
    private String location;

    // --- USER & STATUS ---
    @Column(nullable = false)
    private String userName;
    @Column(nullable = false)
    private Integer duration; // User's requested minutes (e.g., 30)
    @Column(nullable = false)
    private String status;

    /** * Arrival Timer Base: The moment the "Confirm Booking" button was hit.
     * Used to calculate Late Minutes.
     */
    private LocalDateTime startTime;
    private LocalDateTime endTime;

    // --- BILLING & SYNC FIELDS ---
    private Double bookedDuration; // Duration converted to hours for ₹/hr fees
    private Double totalEnergy;
    private Integer actualDuration; // Total seconds of charging (Synced from CMS/Hardware)

    private Integer lateMinutes;
    private Integer idleMinutes;

    @Column(name = "cancelled_by")
    private String cancelledBy;

    /**
     * Default Constructor
     */
    public Booking() {
        this.status = "PENDING";
        this.startTime = LocalDateTime.now();
        this.lateMinutes = 0;
        this.idleMinutes = 0;
    }

    /**
     * Main Constructor used in ChargerService
     */
    public Booking(Charger charger, Integer duration, String status, String userName) {
        if (charger == null) throw new IllegalArgumentException("Charger cannot be null");
        if (duration == null || duration <= 0) throw new IllegalArgumentException("Duration must be > 0");

        this.charger = charger;
        this.duration = duration;
        this.status = status != null ? status : "BOOKED";
        this.userName = userName;

        // Arrival clock starts now
        this.startTime = LocalDateTime.now();

        this.bookedDuration = duration / 60.0;
        this.lateMinutes = 0;
        this.idleMinutes = 0;

        // Snapshot current charger details
        this.brand = charger.getBrand();
        this.type = charger.getType();
        this.hostName = charger.getHostName();
        this.location = charger.getLocation();
    }
}