package dev.ishtirak.core.common;

import java.util.List;
import java.util.function.Function;

public record PageResponse<T>(List<T> data, PageMeta meta) {
    public static <T> PageResponse<T> of(List<T> items, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.max(limit, 1);
        int from = Math.min((safePage - 1) * safeLimit, items.size());
        int to = Math.min(from + safeLimit, items.size());
        return new PageResponse<>(items.subList(from, to), new PageMeta(items.size(), safePage, safeLimit));
    }

    public <R> PageResponse<R> map(Function<T, R> mapper) {
        return new PageResponse<>(data.stream().map(mapper).toList(), meta);
    }

    public record PageMeta(int total, int page, int limit) {
    }
}
