package com.karocharge.backend.repository;

import com.karocharge.backend.model.Charger;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChargerRepository extends JpaRepository<Charger, Long> {

    // Get chargers by status (AVAILABLE / BOOKED)
    List<Charger> findByStatus(String status);
    List<Charger> findByHostName(String hostName);

}
