#!/usr/bin/env python3
"""Generate a deterministic synthetic data/who.db placeholder.

This script exists ONLY because the build environment cannot reach
cdn.who.int. It produces a SQLite database with the same schema as
scripts/who-db.py, populated with smooth, plausible LMS values across
the four WHO indicators for both genders. It is intended as a
short-lived placeholder so the rest of the application can be developed
and tested.

To replace the placeholder with real WHO data, run:

    bash scripts/who-db.sh --force

That script downloads the official WHO expanded LMS Excel tables and
overwrites data/who.db. No application code needs to change.

Usage:
    python scripts/who-db-synthetic.py --output data/who.db
"""

from __future__ import annotations

import argparse
import math
import os
import sqlite3
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS who_lms_standards (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT NOT NULL,
  gender    TEXT NOT NULL,
  x_value   REAL NOT NULL,
  l         REAL NOT NULL,
  m         REAL NOT NULL,
  s         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_who_lms_lookup
  ON who_lms_standards (indicator, gender, x_value);
"""


@dataclass(frozen=True)
class Anchor:
    x: float
    m: float


def piecewise_linear(anchors: list[Anchor]) -> Callable[[float], float]:
    """Return a function that linearly interpolates between (x, m) anchors."""
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


# Approximate medians at key ages (months) — roughly tracking WHO published
# 50th-percentile values. These are smoothed anchors, not the exact WHO
# numbers; the synthetic database is a placeholder.
HFA_BOY = piecewise_linear([
    Anchor(0, 49.9), Anchor(3, 61.4), Anchor(6, 67.6),
    Anchor(12, 75.7), Anchor(24, 87.1), Anchor(36, 95.6),
    Anchor(60, 109.9), Anchor(96, 128.0), Anchor(120, 138.4),
    Anchor(144, 149.3), Anchor(168, 162.0), Anchor(192, 173.0),
    Anchor(228, 176.5),
])
HFA_GIRL = piecewise_linear([
    Anchor(0, 49.1), Anchor(3, 59.8), Anchor(6, 65.7),
    Anchor(12, 74.0), Anchor(24, 85.7), Anchor(36, 94.2),
    Anchor(60, 109.4), Anchor(96, 127.5), Anchor(120, 138.6),
    Anchor(144, 151.2), Anchor(168, 159.6), Anchor(192, 162.5),
    Anchor(228, 163.1),
])

WFA_BOY = piecewise_linear([
    Anchor(0, 3.3), Anchor(3, 6.4), Anchor(6, 7.9),
    Anchor(12, 9.6), Anchor(24, 12.2), Anchor(36, 14.3),
    Anchor(60, 18.3), Anchor(96, 25.4), Anchor(120, 31.0),
])
WFA_GIRL = piecewise_linear([
    Anchor(0, 3.2), Anchor(3, 5.8), Anchor(6, 7.3),
    Anchor(12, 8.9), Anchor(24, 11.5), Anchor(36, 13.9),
    Anchor(60, 18.2), Anchor(96, 25.8), Anchor(120, 31.9),
])

# Weight-for-height: x = height in cm, m = weight in kg.
WFH_BOY = piecewise_linear([
    Anchor(45, 2.4), Anchor(50, 3.3), Anchor(55, 4.4),
    Anchor(60, 5.7), Anchor(65, 7.1), Anchor(70, 8.4),
    Anchor(80, 10.8), Anchor(90, 12.7), Anchor(100, 15.2),
    Anchor(110, 18.4), Anchor(120, 22.8),
])
WFH_GIRL = piecewise_linear([
    Anchor(45, 2.5), Anchor(50, 3.4), Anchor(55, 4.4),
    Anchor(60, 5.6), Anchor(65, 6.9), Anchor(70, 8.2),
    Anchor(80, 10.5), Anchor(90, 12.6), Anchor(100, 15.0),
    Anchor(110, 18.5), Anchor(120, 23.0),
])

BFA_BOY = piecewise_linear([
    Anchor(0, 13.4), Anchor(3, 16.9), Anchor(6, 17.3),
    Anchor(12, 16.8), Anchor(24, 16.0), Anchor(36, 15.7),
    Anchor(60, 15.3), Anchor(96, 15.7), Anchor(120, 16.6),
    Anchor(144, 17.9), Anchor(168, 19.7), Anchor(192, 21.4),
    Anchor(228, 22.4),
])
BFA_GIRL = piecewise_linear([
    Anchor(0, 13.3), Anchor(3, 16.4), Anchor(6, 16.8),
    Anchor(12, 16.4), Anchor(24, 15.7), Anchor(36, 15.5),
    Anchor(60, 15.2), Anchor(96, 15.7), Anchor(120, 16.7),
    Anchor(144, 18.4), Anchor(168, 20.2), Anchor(192, 21.4),
    Anchor(228, 21.5),
])


@dataclass(frozen=True)
class Plan:
    indicator: str
    gender: str
    x_min: float
    x_max: float
    x_step: float
    m_fn: Callable[[float], float]
    l: float
    s: float


PLANS: tuple[Plan, ...] = (
    Plan("HEIGHT_FOR_AGE", "MALE",   0, 228, 1.0, HFA_BOY,  1.0,  0.040),
    Plan("HEIGHT_FOR_AGE", "FEMALE", 0, 228, 1.0, HFA_GIRL, 1.0,  0.040),
    Plan("WEIGHT_FOR_AGE", "MALE",   0, 120, 1.0, WFA_BOY,  0.20, 0.130),
    Plan("WEIGHT_FOR_AGE", "FEMALE", 0, 120, 1.0, WFA_GIRL, 0.20, 0.135),
    Plan("WEIGHT_FOR_HEIGHT", "MALE",   45, 120, 0.5, WFH_BOY,  -0.35, 0.080),
    Plan("WEIGHT_FOR_HEIGHT", "FEMALE", 45, 120, 0.5, WFH_GIRL, -0.40, 0.085),
    Plan("BMI_FOR_AGE", "MALE",   0, 228, 1.0, BFA_BOY,  -0.30, 0.085),
    Plan("BMI_FOR_AGE", "FEMALE", 0, 228, 1.0, BFA_GIRL, -0.30, 0.090),
)


def frange(start: float, stop: float, step: float):
    n = int(round((stop - start) / step))
    for i in range(n + 1):
        yield round(start + i * step, 6)


def build_rows(plan: Plan):
    rows = []
    for x in frange(plan.x_min, plan.x_max, plan.x_step):
        m = plan.m_fn(x)
        # tiny smooth wobble so curves are not perfectly piecewise linear
        m_adj = m * (1.0 + 0.0008 * math.sin(x / 6.0))
        rows.append((plan.indicator, plan.gender, x, plan.l, round(m_adj, 4), plan.s))
    return rows


def write_db(target: Path) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="who-syn-", suffix=".db", dir=str(target.parent))
    os.close(fd)
    tmp_db = Path(tmp_path)
    try:
        conn = sqlite3.connect(tmp_db)
        try:
            conn.executescript(SCHEMA_SQL)
            total = 0
            for plan in PLANS:
                rows = build_rows(plan)
                conn.execute("BEGIN")
                conn.executemany(
                    "INSERT INTO who_lms_standards "
                    "(indicator, gender, x_value, l, m, s) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    rows,
                )
                conn.commit()
                total += len(rows)
                print(f"  {plan.indicator:<18} {plan.gender:<6} -> {len(rows):>4} rows")
            conn.execute("VACUUM")
        finally:
            conn.close()
        os.replace(tmp_db, target)
        return total
    except Exception:
        try:
            tmp_db.unlink()
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parent.parent / "data" / "who.db"),
    )
    args = parser.parse_args()
    output_path = Path(args.output).resolve()

    print(f"Generating synthetic placeholder at {output_path} ...")
    total = write_db(output_path)
    size = output_path.stat().st_size
    print(
        f"\n[!] PLACEHOLDER who.db written: {total} rows, {size // 1024} KB.\n"
        f"    Replace with real WHO data by running:\n"
        f"        bash scripts/who-db.sh --force\n"
    )


if __name__ == "__main__":
    main()
