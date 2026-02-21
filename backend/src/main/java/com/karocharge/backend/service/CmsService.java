package com.karocharge.backend.service;

import com.karocharge.backend.dto.CmsRequestDTO;
import com.karocharge.backend.dto.CmsResponseDTO;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class CmsService {

    private final RestTemplate restTemplate;
    // Matches your CMS port and RequestMapping
    private final String CMS_BASE_URL = "http://localhost:9090/api/cms/chargers";

    public CmsService() {
        this.restTemplate = new RestTemplate();
    }

    public boolean unblockCharger(CmsRequestDTO request) {
        try {
            // This builds: http://localhost:9090/api/cms/chargers/38/unblock
            String url = CMS_BASE_URL + "/" + request.getChargerId() + "/unblock";

            System.out.println("Calling CMS at: " + url);

            // Using postForEntity with 'null' for the body because the ID is in the URL
            ResponseEntity<CmsResponseDTO> response = restTemplate.postForEntity(
                    url,
                    null,
                    CmsResponseDTO.class
            );

            if (response.getBody() != null) {
                System.out.println("CMS Response: " + response.getBody().getStatus());
                return "success".equalsIgnoreCase(response.getBody().getStatus());
            }
            return false;
        } catch (Exception e) {
            System.err.println("Failed to connect to CMS Simulator: " + e.getMessage());
            return false; // Triggers the 500 error in your BookingController
        }
    }
}