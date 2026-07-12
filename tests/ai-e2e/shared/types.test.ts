import { describe, it, expectTypeOf } from 'vitest';
import type { ScenarioType, VerificationStatus, ScenarioConfig } from './types';

describe('shared/types', () => {
    describe('ScenarioType', () => {
        it('should accept valid click-translate scenario type', () => {
            expectTypeOf<'click-translate'>().toMatchTypeOf<ScenarioType>();
        });

        it('should accept valid drag-select scenario type', () => {
            expectTypeOf<'drag-select'>().toMatchTypeOf<ScenarioType>();
        });

        it('should reject invalid scenario type literals', () => {
            // @ts-expect-error - this type should NOT be assignable to ScenarioType
            expectTypeOf<'invalid-scenario'>().not.toMatchTypeOf<ScenarioType>();
        });

        it('should reject arbitrary string', () => {
            expectTypeOf<string>().not.toMatchTypeOf<ScenarioType>();
        });
    });

    describe('VerificationStatus', () => {
        it('should include passed status', () => {
            expectTypeOf<'passed'>().toMatchTypeOf<VerificationStatus>();
        });

        it('should include failed status', () => {
            expectTypeOf<'failed'>().toMatchTypeOf<VerificationStatus>();
        });

        it('should include skipped status', () => {
            expectTypeOf<'skipped'>().toMatchTypeOf<VerificationStatus>();
        });

        it('should reject invalid status literal', () => {
            // @ts-expect-error - 'pending' is not a valid VerificationStatus
            expectTypeOf<'pending'>().not.toMatchTypeOf<VerificationStatus>();
        });

        it('should reject arbitrary string', () => {
            expectTypeOf<string>().not.toMatchTypeOf<VerificationStatus>();
        });
    });

    describe('ScenarioConfig', () => {
        it('should have a name of type ScenarioType', () => {
            type ConfigName = ScenarioConfig['name'];
            expectTypeOf<ConfigName>().toMatchTypeOf<ScenarioType>();
        });

        it('should have a description of type string', () => {
            type ConfigDesc = ScenarioConfig['description'];
            expectTypeOf<ConfigDesc>().toMatchTypeOf<string>();
        });

        it('should have an expectedBehavior of type string', () => {
            type ConfigExpected = ScenarioConfig['expectedBehavior'];
            expectTypeOf<ConfigExpected>().toMatchTypeOf<string>();
        });

        it('should have an optional fixturePage of type string', () => {
            const valid: ScenarioConfig = {
                name: 'click-translate',
                description: 'Test click translation',
                expectedBehavior: 'Translation appears',
                fixtureLevel: 'fixture',
            };
            // fixturePage is optional - should compile without it
            expect(valid.name).toBe('click-translate');
            expect(valid.fixturePage).toBeUndefined();
        });

        it('should accept fixturePage when provided', () => {
            const valid: ScenarioConfig = {
                name: 'click-translate',
                description: 'Test click translation',
                expectedBehavior: 'Translation appears',
                fixturePage: 'click-translate.html',
                fixtureLevel: 'fixture',
            };
            expect(valid.fixturePage).toBe('click-translate.html');
        });

        it('should have fixtureLevel of type fixture | real', () => {
            const validFixture: ScenarioConfig = {
                name: 'click-translate',
                description: 'Test',
                expectedBehavior: 'Expected',
                fixtureLevel: 'fixture',
            };
            expect(validFixture.fixtureLevel).toBe('fixture');

            const validReal: ScenarioConfig = {
                name: 'drag-select',
                description: 'Test',
                expectedBehavior: 'Expected',
                fixtureLevel: 'real',
            };
            expect(validReal.fixtureLevel).toBe('real');
        });

        it('should reject invalid fixtureLevel value', () => {
            // @ts-expect-error - 'mock' is not a valid fixtureLevel
            const invalid: ScenarioConfig = {
                name: 'click-translate',
                description: 'Test',
                expectedBehavior: 'Expected',
                fixtureLevel: 'mock',
            };
            expect(invalid).toBeDefined();
        });
    });
});
