import { describe, expect, it } from "vitest";
import { SettingsManager } from "./settings-manager.ts";

describe("auto handoff settings", () => {
	it("seeds persisted defaults for existing user settings", async () => {
		const manager = SettingsManager.inMemory({ theme: "dark" });
		await manager.flush();
		await manager.reload();

		expect(manager.getAutoHandoffEnabled()).toBe(false);
		expect(manager.getAutoHandoffThresholdTokens()).toBe(128_000);
		expect(manager.getGlobalSettings().autoHandoff).toEqual({
			enabled: false,
			thresholdTokens: 128_000,
		});
	});

	it("preserves configured auto handoff values while filling missing fields", async () => {
		const manager = SettingsManager.inMemory({ autoHandoff: { enabled: true } });
		await manager.flush();

		expect(manager.getGlobalSettings().autoHandoff).toEqual({
			enabled: true,
			thresholdTokens: 128_000,
		});
	});

	it("persists enabled state", async () => {
		const manager = SettingsManager.inMemory();
		manager.setAutoHandoffEnabled(true);
		await manager.flush();
		expect(manager.getAutoHandoffEnabled()).toBe(true);
		expect(manager.getGlobalSettings().autoHandoff?.enabled).toBe(true);
	});

	it("persists threshold and clamps to minimum 1000", async () => {
		const manager = SettingsManager.inMemory();
		manager.setAutoHandoffThresholdTokens(64_000);
		await manager.flush();
		expect(manager.getAutoHandoffThresholdTokens()).toBe(64_000);

		manager.setAutoHandoffThresholdTokens(500);
		await manager.flush();
		expect(manager.getAutoHandoffThresholdTokens()).toBe(1000);

		manager.setAutoHandoffThresholdTokens(128_500.7);
		await manager.flush();
		expect(manager.getAutoHandoffThresholdTokens()).toBe(128_500);
	});
});
