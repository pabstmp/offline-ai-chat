// Smoke test — verifica que fast-check importa corretamente
import fc from "fast-check";

// Propriedade trivial: qualquer inteiro somado a zero é ele mesmo
fc.assert(
  fc.property(fc.integer(), (n) => n + 0 === n),
  { numRuns: 10 }
);

console.log("✓ fast-check smoke test passed");
