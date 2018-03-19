"use strict";

import { Map } from "immutable";

import { TypeAttributeKind } from "./TypeAttributes";
import { checkStringMap, isStringMap, checkArray, panic } from "./Support";
import { EnumType } from "./Type";

export type AccessorEntry = string | { [ language: string ]: string };

export type AccessorNames = { [ key: string ]: AccessorEntry } | AccessorEntry[];

export const accessorNamesTypeAttributeKind = new TypeAttributeKind<AccessorNames>(
    "accessorNames",
    undefined,
    _ => undefined,
    undefined);

function isAccessorEntry(x: any): x is AccessorEntry {
    if (typeof x === "string") {
        return true;
    }
    return isStringMap(x, (v: any): v is string => typeof v === "string");
}

export function checkAccessorNames(x: any): AccessorNames {
    if (Array.isArray(x)) {
        return checkArray(x, isAccessorEntry);
    } else {
        return checkStringMap(x, isAccessorEntry);
    }
}

function lookupKey(accessors: AccessorNames, key: string, language: string): string | undefined {
    if (Array.isArray(accessors)) {
        return panic(`Accessors must be object, but is an array: ${JSON.stringify(accessors)}`);
    }

    if (!Object.prototype.hasOwnProperty.call(accessors, key)) return undefined;

    const entry = accessors[key];
    if (typeof entry === "string") return entry;

    const maybeForLanguage = entry[language];
    if (maybeForLanguage !== undefined) return maybeForLanguage;

    const maybeCatchAll = entry["*"];
    if (maybeCatchAll !== undefined) return maybeCatchAll;

    return undefined;
}

export function enumCaseNames(e: EnumType, language: string): Map<string, string | undefined> {
    const accessors = accessorNamesTypeAttributeKind.tryGetInAttributes(e.getAttributes());
    const map = e.cases.toMap();
    if (accessors === undefined) return map.map(_ => undefined);
    return map.map(c => lookupKey(accessors, c, language));
}
