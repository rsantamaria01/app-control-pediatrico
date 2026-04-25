#!/usr/bin/env python3
"""Generate mock CDC growth-chart CSV files for local/demo use.

CDC publishes the LMS parameters as Excel tables split into infant
(0-36 months) and child (24-240 months) ranges. We combine them into a
single CSV per indicator and follow the naming convention:

    <xAxis>_<yAxis>_<minMonth>_<maxMonth>.csv

Where xAxis/yAxis use the abbreviations the user defined:

    a  = age (months)
    w  = weight (kg)
    h  = height/stature (cm)
    l  = length (cm)              -> infant length-for-age
    b  = bmi
    hc = head circumference (cm)

Examples:

    w_a_0_240.csv  weight-for-age, 0-240 months
    h_a_0_240.csv  height/length-for-age, 0-240 months (infant length
                   below 24 months, child stature above 24 months)
    b_a_24_240.csv BMI-for-age, 24-240 months
    hc_a_0_36.csv  head-circumference-for-age, 0-36 months
    w_h_45_121.csv weight-for-stature; here the trailing numbers are
                   stature in cm rather than months (CDC's only chart
                   not indexed by age)

The CSV column layout matches the CDC published tables:

    Sex,X,L,M,S,P3,P5,P10,P25,P50,P75,P85,P90,P95,P97

Sex is `1` for male and `2` for female (CDC convention).
The percentile columns are derived from L, M, S so the file is
self-describing even though the API only consumes L, M, S.

These mock values are smoothed plausible curves anchored to the CDC
50th-percentile medians. Replace with the real CDC files in
data/lms/ to use real reference data; the application reads any CSV
that follows the naming convention and column layout above.
"""
from __future__ import annotations

import argparse
import csv
import math
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

# Z-scores mapped to the CDC published percentiles.
PERCENTILES: tuple[tuple[str, float], ...] = (
    ("P3", -1.881),
    ("P5", -1.645),
    ("P10", -1.282),
    ("P25", -0.674),
    ("P50", 0.0),
    ("P75", 0.674),
    ("P85", 1.036),
    ("P90", 1.282),
    ("P95", 1.645),
    ("P97", 1.881),
)


def value_at_z(z: float, l: float, m: float, s: float) -> float:
    if l == 0:
        return m * math.exp(s * z)
    return m * math.pow(1 + l * s * z, 1.0 / l)


@dataclass(frozen=True)
class Anchor:
    x: float
    m: float


def piecewise_linear(anchors: list[Anchor]) -> Callable[[float], float]:
    sorted_anchors = sorted(anchors, key=lambda a: a.x)

    def f(x: float) -> float:
        if x <= sorted_anchors[0].x:
            return sorted_anchors[0].m
        if x >= sorted_anchors[-1].x:
            return sorted_anchors[-1].m
        for a, b in zip(sorted_anchors, sorted_anchors[1:]):
            if a.x <= x <= b.x:
                t = (x - a.x) / (b.x - a.x)
                return a.m + t * (b.m - a.m)
        return sorted_anchors[-1].m

    return f


# Median anchors — values approximate the CDC 50th-percentile curves.
HFA_BOY = piecewise_linear([
    Anchor(0, 49.9), Anchor(3, 61.4), Anchor(6, 67.6),
    Anchor(12, 75.7), Anchor(24, 87.1), Anchor(36, 95.6),
    Anchor(60, 109.9), Anchor(96, 128.0), Anchor(120, 138.4),
    Anchor(144, 149.3), Anchor(168, 162.0), Anchor(192, 173.0),
    Anchor(228, 176.5), Anchor(240, 176.7),
])
HFA_GIRL = piecewise_linear([
    Anchor(0, 49.1), Anchor(3, 59.8), Anchor(6, 65.7),
    Anchor(12, 74.0), Anchor(24, 85.7), Anchor(36, 94.2),
    Anchor(60, 109.4), Anchor(96, 127.5), Anchor(120, 138.6),
    Anchor(144, 151.2), Anchor(168, 159.6), Anchor(192, 162.5),
    Anchor(228, 163.1), Anchor(240, 163.2),
])

WFA_BOY = piecewise_linear([
    Anchor(0, 3.3), Anchor(3, 6.4), Anchor(6, 7.9),
    Anchor(12, 9.6), Anchor(24, 12.2), Anchor(36, 14.3),
    Anchor(60, 18.3), Anchor(96, 25.4), Anchor(120, 31.0),
    Anchor(144, 38.0), Anchor(168, 50.0), Anchor(192, 62.0),
    Anchor(228, 70.0), Anchor(240, 70.5),
])
WFA_GIRL = piecewise_linear([
    Anchor(0, 3.2), Anchor(3, 5.8), Anchor(6, 7.3),
    Anchor(12, 8.9), Anchor(24, 11.5), Anchor(36, 13.9),
    Anchor(60, 18.2), Anchor(96, 25.8), Anchor(120, 31.9),
    Anchor(144, 41.5), Anchor(168, 50.0), Anchor(192, 55.0),
    Anchor(228, 56.5), Anchor(240, 56.6),
])

# Weight-for-stature: x = stature in cm, m = weight in kg.
WFH_BOY = piecewise_linear([
    Anchor(45, 2.4), Anchor(50, 3.3), Anchor(55, 4.4),
    Anchor(60, 5.7), Anchor(65, 7.1), Anchor(70, 8.4),
    Anchor(80, 10.8), Anchor(90, 12.7), Anchor(100, 15.2),
    Anchor(110, 18.4), Anchor(121, 22.8),
])
WFH_GIRL = piecewise_linear([
    Anchor(45, 2.5), Anchor(50, 3.4), Anchor(55, 4.4),
    Anchor(60, 5.6), Anchor(65, 6.9), Anchor(70, 8.2),
    Anchor(80, 10.5), Anchor(90, 12.6), Anchor(100, 15.0),
    Anchor(110, 18.5), Anchor(121, 23.0),
])

BFA_BOY = piecewise_linear([
    Anchor(24, 16.0), Anchor(36, 15.7), Anchor(60, 15.3),
    Anchor(96, 15.7), Anchor(120, 16.6), Anchor(144, 17.9),
    Anchor(168, 19.7), Anchor(192, 21.4), Anchor(228, 22.4),
    Anchor(240, 22.5),
])
BFA_GIRL = piecewise_linear([
    Anchor(24, 15.7), Anchor(36, 15.5), Anchor(60, 15.2),
    Anchor(96, 15.7), Anchor(120, 16.7), Anchor(144, 18.4),
    Anchor(168, 20.2), Anchor(192, 21.4), Anchor(228, 21.5),
    Anchor(240, 21.5),
])

HC_BOY = piecewise_linear([
    Anchor(0, 34.5), Anchor(3, 40.5), Anchor(6, 43.3),
    Anchor(12, 46.0), Anchor(24, 48.3), Anchor(36, 49.5),
])
HC_GIRL = piecewise_linear([
    Anchor(0, 33.9), Anchor(3, 39.5), Anchor(6, 42.2),
    Anchor(12, 44.9), Anchor(24, 47.2), Anchor(36, 48.4),
])


@dataclass(frozen=True)
class Plan:
    filename: str
    sex_label: int  # 1 male, 2 female
    x_min: float
    x_max: float
    x_step: float
    m_fn: Callable[[float], float]
    l: float
    s: float


PLANS: tuple[Plan, ...] = (
    # height-for-age (combined infant length + child stature), 0-240 months
    Plan("h_a_0_240.csv", 1, 0, 240, 1.0, HFA_BOY,  1.0,  0.040),
    Plan("h_a_0_240.csv", 2, 0, 240, 1.0, HFA_GIRL, 1.0,  0.040),
    # weight-for-age, 0-240 months
    Plan("w_a_0_240.csv", 1, 0, 240, 1.0, WFA_BOY,  0.20, 0.130),
    Plan("w_a_0_240.csv", 2, 0, 240, 1.0, WFA_GIRL, 0.20, 0.135),
    # weight-for-stature; trailing numbers are stature in cm.
    Plan("w_h_45_121.csv", 1, 45, 121, 0.5, WFH_BOY,  -0.35, 0.080),
    Plan("w_h_45_121.csv", 2, 45, 121, 0.5, WFH_GIRL, -0.40, 0.085),
    # bmi-for-age, 24-240 months (CDC chart starts at 24 months)
    Plan("b_a_24_240.csv", 1, 24, 240, 1.0, BFA_BOY,  -0.30, 0.085),
    Plan("b_a_24_240.csv", 2, 24, 240, 1.0, BFA_GIRL, -0.30, 0.090),
    # head-circumference-for-age, 0-36 months
    Plan("hc_a_0_36.csv", 1, 0, 36, 0.5, HC_BOY,  1.0, 0.035),
    Plan("hc_a_0_36.csv", 2, 0, 36, 0.5, HC_GIRL, 1.0, 0.035),
)


def frange(start: float, stop: float, step: float) -> Iterable[float]:
    n = int(round((stop - start) / step))
    for i in range(n + 1):
        yield round(start + i * step, 6)


def build_rows(plan: Plan) -> list[list[str]]:
    out: list[list[str]] = []
    for x in frange(plan.x_min, plan.x_max, plan.x_step):
        m = plan.m_fn(x)
        # tiny smooth wobble so curves are not perfectly piecewise linear
        m_adj = m * (1.0 + 0.0008 * math.sin(x / 6.0))
        row = [
            str(plan.sex_label),
            f"{x:g}",
            f"{plan.l:.6f}",
            f"{m_adj:.6f}",
            f"{plan.s:.6f}",
        ]
        for _, z in PERCENTILES:
            row.append(f"{value_at_z(z, plan.l, m_adj, plan.s):.4f}")
        out.append(row)
    return out


HEADER = ["Sex", "X", "L", "M", "S"] + [name for name, _ in PERCENTILES]


def write_atomic(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="lms-", suffix=".csv", dir=str(path.parent))
    os.close(fd)
    tmp = Path(tmp_path)
    try:
        with tmp.open("w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(HEADER)
            writer.writerows(rows)
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parent.parent / "data" / "lms"),
    )
    args = parser.parse_args()
    out_dir = Path(args.output_dir).resolve()

    grouped: dict[str, list[list[str]]] = {}
    for plan in PLANS:
        rows = build_rows(plan)
        grouped.setdefault(plan.filename, []).extend(rows)

    print(f"Writing mock CDC LMS CSVs to {out_dir} ...")
    for filename, rows in grouped.items():
        # sort by sex then x for readability
        rows.sort(key=lambda r: (int(r[0]), float(r[1])))
        target = out_dir / filename
        write_atomic(target, rows)
        print(f"  {filename:<20} {len(rows):>5} rows")

    print(
        "\n[!] Mock CSVs written. Replace with real CDC files from\n"
        "    https://www.cdc.gov/growthcharts/cdc-data-files.htm\n"
        "    using the same naming convention (xAxis_yAxis_minMonth_maxMonth.csv).\n"
    )


if __name__ == "__main__":
    main()
