package dev.ishtirak.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Entry point for the Ishtirak system-of-record service. */
@SpringBootApplication
public class IshtirakApplication {

    public static void main(String[] args) {
        SpringApplication.run(IshtirakApplication.class, args);
    }
}
