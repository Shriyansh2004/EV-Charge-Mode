package com.karocharge.cms.controller;

import com.karocharge.cms.dto.CmsRequestDTO;
import com.karocharge.cms.dto.CmsResponseDTO;
import com.karocharge.cms.service.CmsService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/cms")
@CrossOrigin(origins = "*")
public class CmsController {

    private final CmsService cmsService;

    public CmsController(CmsService cmsService) {
        this.cmsService = cmsService;
    }

    // 1. Block charger (Physical simulation)
    @PostMapping("/chargers/{id}/block")
    public ResponseEntity<CmsResponseDTO> blockCharger(@PathVariable Long id) {
        CmsRequestDTO request = new CmsRequestDTO();
        request.setChargerId(id);
        return ResponseEntity.ok(cmsService.blockCharger(request));
    }

    // 2. Unblock charger AND START energy counter
    @PostMapping("/chargers/{id}/unblock")
    public ResponseEntity<CmsResponseDTO> unblockCharger(@PathVariable Long id) {
        CmsRequestDTO request = new CmsRequestDTO();
        request.setChargerId(id);
        return ResponseEntity.ok(cmsService.unblockCharger(request));
    }

    // 3. STOP energy counter and send totals back to KaroCharge
    @PostMapping("/chargers/{id}/stop")
    public ResponseEntity<CmsResponseDTO> stopSession(@PathVariable Long id) {
        System.out.println("CMS received STOP request for Charger ID: " + id);
        return ResponseEntity.ok(cmsService.stopChargingSession(id));
    }
}