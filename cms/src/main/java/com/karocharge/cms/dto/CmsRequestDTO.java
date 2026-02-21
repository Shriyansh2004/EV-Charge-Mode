package com.karocharge.cms.dto;

public class CmsRequestDTO {

    private Long chargerId;
    private Integer duration; // used only for block

    public Long getChargerId() {
        return chargerId;
    }

    public void setChargerId(Long chargerId) {
        this.chargerId = chargerId;
    }

    public Integer getDuration() {
        return duration;
    }

    public void setDuration(Integer duration) {
        this.duration = duration;
    }
}
