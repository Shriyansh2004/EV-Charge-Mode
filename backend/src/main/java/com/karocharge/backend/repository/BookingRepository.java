package com.karocharge.backend.repository;

import com.karocharge.backend.model.Booking;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface BookingRepository extends JpaRepository<Booking, Long> {

    // Standard lookups
    List<Booking> findByUserName(String userName);
    List<Booking> findByStatus(String status);
    List<Booking> findByChargerId(Long chargerId);

    /**
     * Finds the most recent booking for a specific charger that is either
     * CHARGING or CANCELLED. This ensures the billing data from CMS is
     * always attached to the right session.
     */
    Booking findTopByChargerIdAndStatusOrderByStartTimeDesc(Long chargerId, String status);

    /**
     * Find bookings that are past their expected end time but haven't finished.
     * Useful for cleanup tasks or auto-calculating idle fees.
     */
    List<Booking> findByEndTimeBeforeAndStatus(LocalDateTime time, String status);

    /**
     * OPTIONAL: A custom query to find the 'Active' session regardless of
     * whether it was just cancelled or is still charging.
     */
    @Query("SELECT b FROM Booking b WHERE b.charger.id = :chargerId " +
            "AND b.status IN ('CHARGING', 'CANCELLED') " +
            "ORDER BY b.startTime DESC")
    List<Booking> findActiveSessions(@Param("chargerId") Long chargerId);
}