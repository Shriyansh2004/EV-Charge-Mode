package com.karocharge.backend.controller;

import com.karocharge.backend.model.Booking;
import com.karocharge.backend.repository.BookingRepository;
import com.karocharge.backend.service.ChargerService;
import com.karocharge.backend.service.OtpService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/bookings")
@CrossOrigin(origins = "http://localhost:5173")
public class BookingController {

    private final ChargerService chargerService;
    private final OtpService otpService;
    private final BookingRepository bookingRepository;

    public BookingController(ChargerService chargerService,
                             OtpService otpService,
                             BookingRepository bookingRepository) {
        this.chargerService = chargerService;
        this.otpService = otpService;
        this.bookingRepository = bookingRepository;
    }

    /**
     * 1. Create Booking
     */
    @PostMapping
    public ResponseEntity<?> createBooking(@RequestBody Booking booking) {
        if (booking.getCharger() == null || booking.getCharger().getId() == null) {
            return ResponseEntity.badRequest().body("Charger ID is required");
        }

        Booking savedBooking = chargerService.bookCharger(
                booking.getCharger().getId(),
                booking.getUserName(),
                booking.getDuration()
        );

        if (savedBooking != null) {
            double durationMins = (booking.getDuration() != null) ? booking.getDuration() : 30;
            double bookedHours = durationMins / 60.0;

            savedBooking.setBookedDuration(bookedHours);
            bookingRepository.save(savedBooking);

            return ResponseEntity.ok(savedBooking);
        }

        return ResponseEntity.status(500).body("Booking failed");
    }

    /**
     * 4. Start charging
     */
    @PostMapping("/{id}/start")
    public ResponseEntity<?> startCharging(@PathVariable Long id) {
        Booking booking = bookingRepository.findById(id).orElse(null);
        if (booking == null) return ResponseEntity.badRequest().body("Booking not found");

        LocalDateTime now = LocalDateTime.now();
        Duration durationPassed = Duration.between(booking.getStartTime(), now);
        long totalMinutesPassed = durationPassed.toMinutes();

        if (totalMinutesPassed > 1) {
            booking.setLateMinutes((int) (totalMinutesPassed - 1));
        } else {
            booking.setLateMinutes(0);
        }

        boolean cmsSuccess = chargerService.triggerCmsUnblock(booking.getCharger().getId());

        if (!cmsSuccess) {
            return ResponseEntity.status(500).body("Failed to unblock hardware via CMS.");
        }

        booking.setStatus("CHARGING");
        // IMPORTANT: This timestamp is the "Zero Point" for the timer
        booking.setChargingStartedAt(LocalDateTime.now());
        bookingRepository.save(booking);
        chargerService.setChargerToCharging(booking.getCharger().getId());

        return ResponseEntity.ok(Map.of(
                "message", "Charging started",
                "status", "CHARGING",
                "lateMinutes", booking.getLateMinutes()
        ));
    }

    /**
     * 7. Get Booking (FIXED FOR TIMER SYNC)
     * This now calculates the "actualDuration" live so the frontend matches the server clock.
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getBookingById(@PathVariable Long id) {
        return bookingRepository.findById(id)
                .map(booking -> {
                    // Create a response map to include the live calculated duration
                    Map<String, Object> response = new HashMap<>();
                    response.put("id", booking.getId());
                    response.put("status", booking.getStatus());
                    response.put("userName", booking.getUserName());
                    response.put("totalEnergy", booking.getTotalEnergy());
                    response.put("bookedDuration", booking.getBookedDuration());
                    response.put("lateMinutes", booking.getLateMinutes());
                    response.put("idleMinutes", booking.getIdleMinutes());
                    response.put("cancelledBy", booking.getCancelledBy());
                    response.put("charger", booking.getCharger());

                    // --- THE TIMER SYNC FIX ---
                    if ("CHARGING".equals(booking.getStatus()) && booking.getChargingStartedAt() != null) {
                        long liveSeconds = Duration.between(booking.getChargingStartedAt(), LocalDateTime.now()).getSeconds();
                        response.put("actualDuration", liveSeconds);
                    } else {
                        response.put("actualDuration", booking.getActualDuration());
                    }
                    // --------------------------

                    return ResponseEntity.ok(response);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 8. Extend Booking
     * Resets status to CHARGING so the Auto-Stop logic triggers again later.
     */
    @PostMapping("/{id}/extend")
    public ResponseEntity<?> extendBooking(@PathVariable Long id, @RequestParam Integer extraMinutes) {
        Booking booking = bookingRepository.findById(id).orElse(null);
        if (booking == null) return ResponseEntity.badRequest().body("Booking not found");

        // 1. Update the duration limit
        int newDurationMins = booking.getDuration() + extraMinutes;
        booking.setDuration(newDurationMins);
        booking.setBookedDuration(newDurationMins / 60.0);

        // 2. Set status back to CHARGING (in case it was already COMPLETED by auto-stop)
        booking.setStatus("CHARGING");

        // 3. Optional: If the CMS stopped the hardware, we re-trigger unblock
        chargerService.triggerCmsUnblock(booking.getCharger().getId());

        bookingRepository.save(booking);

        return ResponseEntity.ok(Map.of(
                "message", "Session extended",
                "newDuration", newDurationMins,
                "status", "CHARGING"
        ));
    }

    // Existing methods (generateOtp, verifyOtp, stopCharging, receiveSessionData) remain the same...
    @PostMapping("/{id}/generate-otp")
    public ResponseEntity<?> generateOtp(@PathVariable Long id) {
        return ResponseEntity.ok(otpService.generateOtp(id));
    }

    @PostMapping("/{id}/verify-otp")
    public ResponseEntity<?> verifyOtp(@PathVariable Long id, @RequestParam String otp) {
        boolean isValid = otpService.verifyOtp(id, otp);
        if (!isValid) return ResponseEntity.badRequest().body(Map.of("message", "Invalid OTP"));
        return ResponseEntity.ok(Map.of("message", "OTP Verified Successfully"));
    }

    @PostMapping("/{id}/stop")
    public ResponseEntity<?> stopCharging(@PathVariable Long id, @RequestParam(required = false) String cancelledBy) {
        Booking booking = bookingRepository.findById(id).orElse(null);
        if (booking == null) return ResponseEntity.badRequest().body("Booking not found");
        if (cancelledBy != null && !cancelledBy.isEmpty()) {
            booking.setCancelledBy(cancelledBy);
            booking.setStatus("CANCELLED");
            bookingRepository.save(booking);
        }
        String cmsStopUrl = "http://localhost:9090/api/cms/chargers/" + booking.getCharger().getId() + "/stop";
        try {
            new RestTemplate().postForEntity(cmsStopUrl, null, String.class);
            return ResponseEntity.ok(Map.of("message", "Stop signal sent", "cancelledBy", cancelledBy));
        } catch (Exception e) {
            return ResponseEntity.status(500).body("CMS communication error");
        }
    }

    @PostMapping("/complete")
    public ResponseEntity<?> receiveSessionData(@RequestBody Map<String, Object> data) {
        Long chargerId = Long.valueOf(data.get("chargerId").toString());
        Booking booking = bookingRepository.findTopByChargerIdAndStatusOrderByStartTimeDesc(chargerId, "CHARGING");
        if (booking == null) booking = bookingRepository.findTopByChargerIdAndStatusOrderByStartTimeDesc(chargerId, "CANCELLED");

        if (booking != null) {
            if (!"CANCELLED".equals(booking.getStatus())) booking.setStatus("COMPLETED");
            booking.setTotalEnergy(Double.valueOf(data.get("totalEnergy").toString()));
            booking.setActualDuration(Integer.valueOf(data.get("durationSeconds").toString()));
            bookingRepository.save(booking);
            chargerService.unblockChargerLocally(chargerId);
            return ResponseEntity.ok("Sync successful");
        }
        return ResponseEntity.status(404).body("No active session");
    }
}