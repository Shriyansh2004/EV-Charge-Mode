package com.karocharge.cms.service;

import com.karocharge.cms.dto.CmsRequestDTO;
import com.karocharge.cms.dto.CmsResponseDTO;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CmsService {

    private final RestTemplate restTemplate;

    // Tracks ChargerID -> Current Energy (kWh)
    private final Map<Long, Double> energyCounters = new ConcurrentHashMap<>();
    // Tracks ChargerID -> Session Start Timestamp
    private final Map<Long, Long> startTimestamps = new ConcurrentHashMap<>();

    private final String BACKEND_URL = "http://localhost:8080/api/chargers/";
    private final String BACKEND_BOOKING_URL = "http://localhost:8080/api/bookings/complete";

    public CmsService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    // --- Energy Counter Background Task ---
    @Scheduled(fixedRate = 1000) // Runs every 1 second
    public void incrementEnergy() {
        energyCounters.forEach((id, currentEnergy) -> {
            double newEnergy = currentEnergy + 0.01;
            energyCounters.put(id, newEnergy);
            System.out.println("Charger " + id + " :: energy counter started :: Current Energy: " + String.format("%.2f", newEnergy) + " kWh");
        });
    }

    public CmsResponseDTO unblockCharger(CmsRequestDTO request) {
        try {
            restTemplate.put(BACKEND_URL + request.getChargerId() + "/unblock", null);

            // Initialize the counter for this charger
            energyCounters.put(request.getChargerId(), 0.0);
            startTimestamps.put(request.getChargerId(), System.currentTimeMillis());

            System.out.println("Energy Counter STARTED for Charger " + request.getChargerId());

            return new CmsResponseDTO("SUCCESS", "Charger unblocked and energy counter started");
        } catch (Exception e) {
            System.err.println("CMS to Backend Unblock Error: " + e.getMessage());
            return new CmsResponseDTO("FAIL", "Error calling Backend: " + e.getMessage());
        }
    }

    public CmsResponseDTO stopChargingSession(Long chargerId) {
        try {
            if (!energyCounters.containsKey(chargerId)) {
                return new CmsResponseDTO("FAIL", "No active session for this charger");
            }

            // 1. Capture final values
            double totalEnergy = energyCounters.get(chargerId);
            long totalTimeSeconds = (System.currentTimeMillis() - startTimestamps.get(chargerId)) / 1000;

            // 2. Clear from CMS memory
            energyCounters.remove(chargerId);
            startTimestamps.remove(chargerId);

            System.out.println("Stopping Counter for Charger " + chargerId + ". Total Energy: " + totalEnergy + " kWh");

            // 3. Send final data to Karocharge Backend
            Map<String, Object> finalStats = Map.of(
                    "chargerId", chargerId,
                    "totalEnergy", totalEnergy,
                    "durationSeconds", totalTimeSeconds
            );

            restTemplate.postForEntity(BACKEND_BOOKING_URL, finalStats, String.class);

            return new CmsResponseDTO("SUCCESS", "Session completed and data sent to backend");
        } catch (Exception e) {
            return new CmsResponseDTO("FAIL", "Error stopping session: " + e.getMessage());
        }
    }

    public CmsResponseDTO blockCharger(CmsRequestDTO request) {
        try {
            restTemplate.put(BACKEND_URL + request.getChargerId() + "/block", null);
            return new CmsResponseDTO("SUCCESS", "Charger blocked successfully");
        } catch (Exception e) {
            return new CmsResponseDTO("FAIL", "Error calling Backend: " + e.getMessage());
        }
    }
}