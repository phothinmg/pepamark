/**
 * Public API for Pepamark.
 *
 * @author Pho Thin Maung <https://github.com/phothinmg>
 * @license Apache-2.0
 */

import { yaml } from "./yaml/index.js";
import { frontmatter, type FrontMatterResult } from "./fm/index.js";
import type { pepatype } from "./type/index.js";
import { Pepamark, type PepamarkOptions } from "./pepamark.js";

export type PluginFactory = (...args: any[]) => pepatype.PepaMarkPlugin;

export { yaml, frontmatter, Pepamark };
export type { FrontMatterResult, PepamarkOptions, pepatype };
