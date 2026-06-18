package dev.ishtirak.core.common;

import java.util.List;

public record ApiError(ErrorBody error) {
    public static ApiError of(String code, String message) {
        return new ApiError(new ErrorBody(code, message, List.of()));
    }

    public record ErrorBody(String code, String message, List<FieldIssue> details) {
    }

    public record FieldIssue(String field, String issue) {
    }
}
