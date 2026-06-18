package dev.ishtirak.core.persistence;

import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@Configuration
@EntityScan(basePackageClasses = OperatorEntity.class)
@EnableJpaRepositories(basePackageClasses = Repositories.class, considerNestedRepositories = true)
public class PersistenceConfig {
}
