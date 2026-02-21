package com.karocharge.backend.controller;

import com.karocharge.backend.service.OtpService;
import org.springframework.http.ResponseEntity; // Add this import
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/otp")
@CrossOrigin
public class OtpController {

    private final OtpService otpService;

    // Constructor Injection (fixes "Field injection is not recommended")
    public OtpController(OtpService otpService) {
        this.otpService = otpService;
    }

    @PostMapping("/{bookingId}/generate")
    public ResponseEntity<String> generateOtp(@PathVariable Long bookingId) {
        String otp = otpService.generateOtp(bookingId);
        return ResponseEntity.ok(otp);
    }

    @PostMapping("/{bookingId}/verify")
    public ResponseEntity<?> verifyOtp(@PathVariable Long bookingId,
                                       @RequestParam String otp) {

        boolean verified = otpService.verifyOtp(bookingId, otp);

        if (verified) {
            // Returning a JSON-like string so React can parse it easily
            return ResponseEntity.ok().body("{\"message\": \"OTP Verified Successfully\"}");
        } else {
            return ResponseEntity.status(400).body("{\"message\": \"Invalid OTP\"}");
        }
    }
}