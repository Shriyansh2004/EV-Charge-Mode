package com.karocharge.backend.controller;

import com.karocharge.backend.dto.BookingRequest;
import com.karocharge.backend.model.Booking;
import com.karocharge.backend.model.Charger;
import com.karocharge.backend.repository.ChargerRepository;
import com.karocharge.backend.service.ChargerService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@CrossOrigin(origins = "http://localhost:5173")
@RestController
@RequestMapping("/api/chargers")
public class ChargerController {

    private final ChargerService chargerService;
    private final ChargerRepository chargerRepository;

    public ChargerController(ChargerService chargerService, ChargerRepository chargerRepository) {
        this.chargerService = chargerService;
        this.chargerRepository = chargerRepository;
    }

    // 1. Host a charger
    @PostMapping
    public ResponseEntity<Charger> createCharger(@RequestBody Charger charger) {
        return ResponseEntity.ok(chargerService.createCharger(charger));
    }

    // 2. Get all chargers
    @GetMapping
    public ResponseEntity<List<Charger>> getAllChargers() {
        return ResponseEntity.ok(chargerService.getAllChargers());
    }

    // 3. Get charger by ID
    @GetMapping("/{id}")
    public ResponseEntity<Charger> getChargerById(@PathVariable Long id) {
        Charger charger = chargerService.getChargerById(id);
        if (charger == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(charger);
    }

    // 4. Get chargers by Host Name
    @GetMapping("/host/{hostName}")
    public List<Charger> getByHost(@PathVariable String hostName) {
        return chargerRepository.findByHostName(hostName);
    }

    // 5. Book charger (Block CMS + Create Booking Snapshot)
    @PostMapping("/{id}/book")
    public ResponseEntity<?> bookCharger(
            @PathVariable Long id,
            @RequestBody BookingRequest request) {

        if (request == null || request.getUserName() == null || request.getDuration() == null) {
            return ResponseEntity.badRequest().body("userName and duration are required");
        }

        Booking booking = chargerService.bookCharger(
                id,
                request.getUserName(),
                request.getDuration()
        );

        if (booking == null) {
            return ResponseEntity.badRequest()
                    .body("Booking failed or charger already booked / CMS unreachable");
        }

        return ResponseEntity.ok(booking);
    }

    // --- NEW ENDPOINTS FOR CMS HANDSHAKE ---

    /**
     * Endpoint called by CMS via PUT to confirm/request unblocking.
     * This fixes the "FAIL" error in your CMS log.
     */
    @PutMapping("/{id}/unblock")
    public ResponseEntity<?> unblockCharger(@PathVariable Long id) {
        Charger charger = chargerService.unblockChargerLocally(id);
        if (charger == null) {
            return ResponseEntity.status(404).body("Charger not found for unblocking");
        }
        return ResponseEntity.ok("Charger " + id + " is now AVAILABLE");
    }

    /**
     * Endpoint called by CMS via PUT to confirm/request blocking.
     */
    @PutMapping("/{id}/block")
    public ResponseEntity<?> confirmBlock(@PathVariable Long id) {
        // Since the backend usually initiates the block, this just acknowledges the CMS action
        return ResponseEntity.ok("Block acknowledged by Backend");
    }

    // 6. Manual block (Optional)
    @PostMapping("/{id}/block")
    public ResponseEntity<?> manualBlock(@PathVariable Long id) {
        Charger charger = chargerService.blockCharger(id);
        if (charger == null) {
            return ResponseEntity.badRequest()
                    .body("Charger block failed or already booked / CMS unreachable");
        }
        return ResponseEntity.ok(charger);
    }

    // 7. Ping endpoint
    @GetMapping("/ping")
    public ResponseEntity<String> ping() {
        return ResponseEntity.ok("pong");
    }
}