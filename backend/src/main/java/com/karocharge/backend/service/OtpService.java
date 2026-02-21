package com.karocharge.backend.service;

import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;

@Service
public class OtpService {

    // Stores OTPs for bookingId
    private final Map<Long, String> otpStorage = new HashMap<>();
    private final Random random = new Random();

    // Generate OTP for a booking
    public String generateOtp(Long bookingId) {
        String otp = String.format("%04d", random.nextInt(10000)); // 4-digit OTP
        otpStorage.put(bookingId, otp);
        return otp;
    }

    // Verify OTP for a booking
    public boolean verifyOtp(Long bookingId, String otp) {
        String storedOtp = otpStorage.get(bookingId);
        if (storedOtp != null && storedOtp.equals(otp)) {
            otpStorage.remove(bookingId); // OTP can be used only once
            return true;
        }
        return false;
    }
}
