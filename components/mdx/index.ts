/**
 * The MDX rendering boundary (§5.2). Server-only: importing this barrel from a
 * client component fails the build, which is the point — compiled guide code
 * is evaluated in React Server Components and nowhere else.
 *
 * Client leaves (`Step`, `StepScope`, `Measure`) are still client components;
 * a client file that needs `StepScope` (the checkup wizard) imports it from
 * `@/components/mdx/StepScope` directly.
 */
import "server-only";

export { GuideContent, guideComponents } from "./GuideContent";
export { Illustration } from "./Illustration";
export { Measure } from "./Measure";
export { Step, stepAnchor } from "./Step";
export { StepScope, useActiveStepId } from "./StepScope";
export { Tool } from "./Tool";
export { Warning } from "./Warning";
