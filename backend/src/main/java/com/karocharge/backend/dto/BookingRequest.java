package com.karocharge.backend.dto;

import lombok.Data;

@Data
public class BookingRequest {
    // The name of the guest booking the charger
    private String userName;

    // The duration selected in React (e.g., 15, 30, 60 minutes)
    private Integer duration;

    // Crucial for linking: the ID of the charger being booked
    private Long chargerId;
}