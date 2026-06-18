package dev.ishtirak.core.security;

import java.util.List;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final InternalIdentityInterceptor interceptor;
    private final IdentityArgumentResolver identityArgumentResolver;

    public WebConfig(InternalIdentityInterceptor interceptor, IdentityArgumentResolver identityArgumentResolver) {
        this.interceptor = interceptor;
        this.identityArgumentResolver = identityArgumentResolver;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(interceptor);
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(identityArgumentResolver);
    }
}
