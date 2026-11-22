"""Estimate a similarity transform from source pixels to revision pixels."""

import cv2
import numpy as np


def register(source: np.ndarray, revision: np.ndarray) -> dict:
    sift = cv2.SIFT_create(nfeatures=4000, contrastThreshold=0.02)
    points_a, descriptors_a = sift.detectAndCompute(source, None)
    points_b, descriptors_b = sift.detectAndCompute(revision, None)
    failed = {"quality": "failed", "matrix": None, "anchors": [], "metrics": None}
    if descriptors_a is None or descriptors_b is None:
        return failed

    matcher = cv2.BFMatcher(cv2.NORM_L2)

    def distinctive(a, b):
        return {
            first.queryIdx: first.trainIdx
            for pair in matcher.knnMatch(a, b, k=2)
            if len(pair) == 2
            for first, second in [pair]
            if first.distance < 0.78 * second.distance
        }

    forward = distinctive(descriptors_a, descriptors_b)
    reverse = distinctive(descriptors_b, descriptors_a)
    pairs = [(a, b) for a, b in forward.items() if reverse.get(b) == a]
    if len(pairs) < 6:
        return failed
    a = np.float32([points_a[i].pt for i, _ in pairs])
    b = np.float32([points_b[j].pt for _, j in pairs])
    threshold = max(3, max(revision.shape) * 0.003)
    matrix, inliers = cv2.estimateAffinePartial2D(
        a, b, method=cv2.RANSAC, ransacReprojThreshold=threshold, maxIters=5000
    )
    if matrix is None:
        return failed
    mask = inliers.ravel().astype(bool)
    source_anchors, target_anchors = a[mask], b[mask]
    count = len(target_anchors)
    ratio = count / len(pairs)
    scale = np.hypot(matrix[0, 0], matrix[1, 0])

    def coverage(points, shape):
        return cv2.contourArea(cv2.convexHull(points)) / np.prod(shape)

    spread = min(coverage(source_anchors, source.shape), coverage(target_anchors, revision.shape))
    if count < 6 or ratio < 0.18 or spread < 0.006 or not 0.08 <= scale <= 12:
        return failed
    projected = source_anchors @ matrix[:, :2].T + matrix[:, 2]
    error = float(np.median(np.linalg.norm(projected - target_anchors, axis=1)))
    return {
        "matrix": matrix.tolist(),
        "quality": "good" if count >= 14 and ratio >= 0.45 and spread >= 0.045 and error <= threshold / 2 else "review",
        "metrics": {
            "inliers": count,
            "ratio": ratio,
            "median_error": error,
            "coverage": spread,
        },
        "anchors": [
            {"source": p.tolist(), "target": q.tolist()}
            for p, q in zip(source_anchors[::max(1, (count + 59) // 60)], target_anchors[::max(1, (count + 59) // 60)])
        ],
    }
