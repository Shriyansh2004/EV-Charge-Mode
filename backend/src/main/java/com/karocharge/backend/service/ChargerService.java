package com.karocharge.backend.service;

import com.karocharge.backend.model.Booking;
import com.karocharge.backend.model.Charger;
import com.karocharge.backend.repository.BookingRepository;
import com.karocharge.backend.repository.ChargerRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;

@Service
public class ChargerService {

    private final ChargerRepository chargerRepository;
    private final BookingRepository bookingRepository;
    private final RestTemplate restTemplate;

    public ChargerService(ChargerRepository chargerRepository,
                          BookingRepository bookingRepository,
                          RestTemplate restTemplate) {
        this.chargerRepository = chargerRepository;
        this.bookingRepository = bookingRepository;
        this.restTemplate = restTemplate;
    }

    public Charger createCharger(Charger charger) {
        charger.setStatus("AVAILABLE");
        return chargerRepository.save(charger);
    }

    public List<Charger> getAllChargers() {
        return chargerRepository.findAll();
    }

    public Charger getChargerById(Long id) {
        return chargerRepository.findById(id).orElse(null);
    }

    // --- CORE LOGIC METHODS ---

    /**
     * Handles the booking flow: Checks availability -> CMS Block -> DB Update -> Create Booking
     */
    public Booking bookCharger(Long id, String userName, Integer duration) {
        Charger charger = chargerRepository.findById(id).orElse(null);
        if (charger == null || !"AVAILABLE".equalsIgnoreCase(charger.getStatus())) {
            return null;
        }

        // Step 1: Tell CMS to physically block the hardware
        if (!blockInCms(id)) {
            return null;
        }

        // Step 2: Update local DB status
        charger.setStatus("BOOKED");
        chargerRepository.save(charger);

        Booking booking = new Booking(charger, duration, "BOOKED", userName);
        return bookingRepository.save(booking);
    }

    /**
     * RESTORES missing method: Manual block logic called by ChargerController
     */
    public Charger blockCharger(Long id) {
        Charger charger = chargerRepository.findById(id).orElse(null);
        if (charger == null || !"AVAILABLE".equalsIgnoreCase(charger.getStatus())) {
            return null;
        }

        if (blockInCms(id)) {
            charger.setStatus("BLOCKED");
            return chargerRepository.save(charger);
        }
        return null;
    }

    /**
     * Called by CMS confirmed unblock (Normal or Cancelled) to reset status to AVAILABLE
     */
    public Charger unblockChargerLocally(Long id) {
        Charger charger = chargerRepository.findById(id).orElse(null);
        if (charger == null) return null;

        // Reset the hardware to available for the next guest
        charger.setStatus("AVAILABLE");
        return chargerRepository.save(charger);
    }

    /**
     * Updates status to CHARGING when session starts
     */
    public Charger setChargerToCharging(Long id) {
        Charger charger = chargerRepository.findById(id).orElse(null);
        if (charger == null) return null;

        charger.setStatus("CHARGING");
        return chargerRepository.save(charger);
    }

    // --- CMS API CALLS ---

    private boolean blockInCms(Long id) {
        try {
            String cmsUrl = "http://localhost:9090/api/cms/chargers/" + id + "/block";
            ResponseEntity<String> response = restTemplate.postForEntity(cmsUrl, null, String.class);
            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            System.err.println("CMS Block Failed for ID " + id + ": " + e.getMessage());
            return false;
        }
    }

    /**
     * Tells CMS to unblock (used when starting a session or cancelling a booking)
     */
    public boolean triggerCmsUnblock(Long id) {
        try {
            String cmsUrl = "http://localhost:9090/api/cms/chargers/" + id + "/unblock";
            ResponseEntity<String> response = restTemplate.postForEntity(cmsUrl, null, String.class);
            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            System.err.println("CMS Unblock Trigger Failed for ID " + id + ": " + e.getMessage());
            return false;
        }
    }
}