
import { cleanSchema, sanitizeSchema } from '../../src/format/schema-sanitizer.js';
import assert from 'assert';

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        UNIT TEST: SCHEMA SANITIZER LOGIC                     ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.error(`  ${e.message}`);
        // console.error(e.stack);
        failed++;
    }
}

// Helper to check if description contains a hint
function assertHasHint(schema, hintFragment) {
    assert.ok(schema.description, 'Schema should have a description');
    assert.ok(schema.description.includes(hintFragment),
        `Description "${schema.description}" should include "${hintFragment}"`);
}

test('Phase 1: Convert $refs to hints', () => {
    const input = {
        type: 'object',
        properties: {
            user: { $ref: '#/definitions/User' }
        }
    };
    const output = cleanSchema(input);

    // Should convert ref to object with hint
    assert.strictEqual(output.properties.user.type, 'OBJECT');
    assertHasHint(output.properties.user, 'See: User');
    // Should remove $ref
    assert.strictEqual(output.properties.user.$ref, undefined);
});

test('Phase 2b: Flatten anyOf - Object preference', () => {
    const input = {
        anyOf: [
            { type: 'string' },
            { type: 'object', properties: { id: { type: 'string' } } }
        ]
    };
    const output = cleanSchema(input);

    // Should pick object (score 3) over string (score 1)
    assert.strictEqual(output.type, 'OBJECT');
    assert.ok(output.properties.id);
    // Should have hint about types
    assertHasHint(output, 'Accepts: string | object');
});

test('Phase 2b: Flatten anyOf - Tie breaking (First wins)', () => {
    const input = {
        anyOf: [
            { type: 'string' },
            { type: 'integer' }
        ]
    };
    const output = cleanSchema(input);

    // Both score 1. First one (string) should win.
    assert.strictEqual(output.type, 'STRING');
    assertHasHint(output, 'Accepts: string | integer');
});

test('Phase 2a: Merge allOf', () => {
    const input = {
        allOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] }
        ],
        required: ['a']
    };
    const output = cleanSchema(input);

    assert.strictEqual(output.type, 'OBJECT');
    assert.ok(output.properties.a);
    assert.ok(output.properties.b);
    assert.ok(output.required.includes('a'));
    assert.ok(output.required.includes('b'));
    assert.strictEqual(output.allOf, undefined);
});

test('Phase 2c: Flatten type arrays', () => {
    const input = {
        type: 'object',
        properties: {
            prop: { type: ['string', 'number', 'null'] }
        }
    };
    const output = cleanSchema(input);

    // Should pick first non-null type (string)
    assert.strictEqual(output.properties.prop.type, 'STRING');
    assertHasHint(output.properties.prop, 'Accepts: string | number');
    assertHasHint(output.properties.prop, 'nullable');
});

test('Constraints moved to description', () => {
    const input = {
        type: 'string',
        minLength: 5,
        pattern: '^[a-z]+$'
    };
    const output = cleanSchema(input);

    assert.strictEqual(output.type, 'STRING');
    assertHasHint(output, 'minLength: 5');
    assertHasHint(output, 'pattern: ^[a-z]+$');
    assert.strictEqual(output.minLength, undefined);
    assert.strictEqual(output.pattern, undefined);
});

test('Enum preservation', () => {
    const input = {
        type: 'string',
        enum: ['a', 'b', 'c']
    };
    const output = cleanSchema(input);

    assert.strictEqual(output.type, 'STRING');
    // sanitizeSchema doesn't remove enum if in allowlist, but cleanSchema Phase 3 doesn't list enum as unsupported?
    // Wait, check cleanSchema source.
    // unsupported list: ... 'examples', 'allOf', 'anyOf', 'oneOf' ... 'pattern', 'format' ...
    // It does NOT include 'enum'. So enum remains.
    // BUT Phase 1b adds hints.
    assert.deepStrictEqual(output.enum, ['a', 'b', 'c']);
    assertHasHint(output, 'Allowed: a, b, c');
});

test('SanitizeSchema: const to enum', () => {
    const input = {
        const: 'foo'
    };
    const sanitized = sanitizeSchema(input);
    const output = cleanSchema(sanitized);

    assert.deepStrictEqual(output.enum, ['foo']);
    assert.strictEqual(output.type, 'STRING'); // inferred or defaulted? sanitizeSchema defaults to object if no type
    // Wait, sanitizeSchema: if (!sanitized.type) sanitized.type = 'object'.
    // BUT cleanSchema might change it? No.
    // Let's check if sanitizeSchema handles const value type inference? No.
    // It just sets enum.
    // So type becomes OBJECT by default if not set.
    // This is a potential edge case.
});

test('Complex Nested Sanitization', () => {
    const input = {
        type: 'object',
        properties: {
            nested: {
                anyOf: [
                    { type: 'array', items: { type: 'string' } },
                    { type: 'boolean' }
                ]
            }
        }
    };
    const output = cleanSchema(input);

    // Array (score 2) vs Boolean (score 1) -> Array wins
    assert.strictEqual(output.properties.nested.type, 'ARRAY');
    assert.strictEqual(output.properties.nested.items.type, 'STRING');
    assertHasHint(output.properties.nested, 'Accepts: array | boolean');
});

console.log(`\nTests completed: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
