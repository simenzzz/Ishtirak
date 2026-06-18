package dev.ishtirak.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Entry point for the Ishtirak system-of-record service. */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class IshtirakApplication {

    public static void main(String[] args) {
        SpringApplication.run(IshtirakApplication.class, args);
    }
}
