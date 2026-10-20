import { test } from "node:test";
import assert from "node:assert/strict";
import { dateInput, dateToISO } from "../src/dates.ts";

test("上海 10-21 零点保存为 UTC 前一日，编辑和详情仍显示 10-21", () => {
  const stored = dateToISO("2026-10-21");
  assert.equal(stored, "2026-10-20T16:00:00.000Z");
  assert.equal(dateInput(stored), "2026-10-21");
  for (let i = 0; i < 5; i++)
    assert.equal(dateToISO(dateInput(stored)), stored);
});
test("可以修改到新日期、清空；输入中的半截日期保留原样", () => {
  for (const input of ["2", "2026-", "2026-10-", "2026-10-2", "2026-10-22 1:"])
    assert.equal(dateInput(input), input);
  assert.equal(dateToISO("2026-10-22"), "2026-10-21T16:00:00.000Z");
  for (const input of ["", "  ", null, undefined])
    assert.equal(dateToISO(input), null);
});
test("不丢失已有时分和 UTC 时刻，跨月跨年按上海时间展示", () => {
  assert.equal(dateToISO("2026-10-21 14:35"), "2026-10-21T06:35:00.000Z");
  assert.equal(dateInput("2026-10-21T06:35:00.000Z"), "2026-10-21 14:35");
  assert.equal(
    dateToISO("2026-10-21T06:35:00.123Z"),
    "2026-10-21T06:35:00.123Z",
  );
  assert.equal(dateInput("2026-12-31T16:05:30.000Z"), "2027-01-01 00:05:30");
  assert.equal(dateInput("2026-09-30T16:00:00.000Z"), "2026-10-01");
  assert.equal(
    dateToISO("2026-10-21T00:00:00+08:00"),
    "2026-10-20T16:00:00.000Z",
  );
});
test("拒绝会被 Date 自动进位的无效日期和时间，允许有效闰日", () => {
  for (const input of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-10-21 25:00",
    "2026-10-21 12:60",
    "2026-10-",
    "tomorrow",
    123,
  ])
    assert.throws(() => dateToISO(input));
  assert.equal(dateToISO("2028-02-29"), "2028-02-28T16:00:00.000Z");
});
