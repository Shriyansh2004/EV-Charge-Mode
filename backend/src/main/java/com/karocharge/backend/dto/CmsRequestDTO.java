package com.karocharge.backend.dto;

public class CmsRequestDTO {

    private Long chargerId;
    private Integer duration; // optional, can be null for unblock requests

    // Default constructor
    public CmsRequestDTO() {}

    // Constructor with parameters
    public CmsRequestDTO(Long chargerId, Integer duration) {
        this.chargerId = chargerId;
        this.duration = duration;
    }

    // Getter and setter for chargerId
    public Long getChargerId() {
        return chargerId;
    }

    public void setChargerId(Long chargerId) {
        this.chargerId = chargerId;
    }

    // Getter and setter for duration
    public Integer getDuration() {
        return duration;
    }

    public void setDuration(Integer duration) {
        this.duration = duration;
    }

    @Override
    public String toString() {
        return "CmsRequestDTO{" +
                "chargerId=" + chargerId +
                ", duration=" + duration +
                '}';
    }
}
