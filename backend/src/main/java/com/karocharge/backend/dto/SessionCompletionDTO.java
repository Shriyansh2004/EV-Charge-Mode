package com.karocharge.backend.dto;

public class SessionCompletionDTO {
    private Long chargerId;
    private Double totalEnergy;
    private Long durationSeconds;

    // Generate Getters and Setters
    public Long getChargerId() { return chargerId; }
    public void setChargerId(Long chargerId) { this.chargerId = chargerId; }
    public Double getTotalEnergy() { return totalEnergy; }
    public void setTotalEnergy(Double totalEnergy) { this.totalEnergy = totalEnergy; }
    public Long getDurationSeconds() { return durationSeconds; }
    public void setDurationSeconds(Long durationSeconds) { this.durationSeconds = durationSeconds; }
}