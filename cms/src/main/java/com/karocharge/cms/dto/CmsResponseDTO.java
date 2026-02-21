package com.karocharge.cms.dto;

public class CmsResponseDTO {

    private String status;
    private String message;

    // No-args constructor required for JSON deserialization
    public CmsResponseDTO() {
    }

    // All-args constructor for convenience
    public CmsResponseDTO(String status, String message) {
        this.status = status;
        this.message = message;
    }

    // Getter and setter for 'status'
    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    // Getter and setter for 'message'
    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
