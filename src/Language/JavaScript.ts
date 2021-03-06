"use strict";

import { Type, matchType, directlyReachableSingleNamedType, ClassProperty } from "../Type";
import { TypeGraph } from "../TypeGraph";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";
import { intercalate } from "../Support";

import { Sourcelike, modifySource } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption, Option } from "../RendererOptions";

const unicode = require("unicode-properties");

export class JavaScriptTargetLanguage extends TargetLanguage {
    protected readonly runtimeTypecheck = new BooleanOption(
        "runtime-typecheck",
        "Verify JSON.parse results at runtime",
        true
    );

    constructor(
        displayName: string = "JavaScript",
        names: string[] = ["javascript", "js", "jsx"],
        extension: string = "js"
    ) {
        super(displayName, names, extension);
    }

    protected getOptions(): Option<any>[] {
        return [this.runtimeTypecheck];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return JavaScriptRenderer;
    }
}

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function typeNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function propertyNameStyle(original: string): string {
    const escaped = utf16StringEscape(original);
    const quoted = `"${escaped}"`;

    if (original.length === 0) {
        return quoted;
    } else if (!isStartCharacter(original.codePointAt(0) as number)) {
        return quoted;
    } else if (escaped !== original) {
        return quoted;
    } else if (legalizeName(original) !== original) {
        return quoted;
    } else {
        return original;
    }
}

export class JavaScriptRenderer extends ConvenienceRenderer {
    constructor(graph: TypeGraph, leadingComments: string[] | undefined, private readonly _runtimeTypecheck: boolean) {
        super(graph, leadingComments);
    }

    protected topLevelNameStyle(rawName: string): string {
        return typeNameStyle(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return new Namer("types", typeNameStyle, []);
    }

    protected namerForClassProperty(): Namer {
        return new Namer("properties", propertyNameStyle, []);
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer("enum-cases", typeNameStyle, []);
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    typeMapTypeFor = (t: Type): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => `undefined`,
            _nullType => `null`,
            _boolType => `false`,
            _integerType => `0`,
            _doubleType => `3.14`,
            _stringType => `""`,
            arrayType => ["a(", this.typeMapTypeFor(arrayType.items), ")"],
            classType => ['o("', this.nameForNamedType(classType), '")'],
            mapType => ["m(", this.typeMapTypeFor(mapType.values), ")"],
            enumType => ['e("', this.nameForNamedType(enumType), '")'],
            unionType => {
                const children = unionType.children.map(this.typeMapTypeFor);
                return ["u(", ...intercalate(", ", children).toArray(), ")"];
            }
        );
    };

    typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        if (!p.isOptional || p.type.isNullable) {
            return this.typeMapTypeFor(p.type);
        }
        return ["u(null, ", this.typeMapTypeFor(p.type), ")"];
    }

    emitBlock = (source: Sourcelike, end: string, emit: () => void) => {
        this.emitLine(source, " {");
        this.indent(emit);
        this.emitLine("}", end);
    };

    emitTypeMap = () => {
        const { any: anyAnnotation } = this.typeAnnotations;

        this.emitBlock(`const typeMap${anyAnnotation} =`, ";", () => {
            this.forEachClass("none", (t, name) => {
                this.emitBlock(['"', name, '":'], ",", () => {
                    this.forEachClassProperty(t, "none", (propName, _propJsonName, property) => {
                        this.emitLine(propName, ": ", this.typeMapTypeForProperty(property), ",");
                    });
                });
            });
            this.forEachEnum("none", (e, name) => {
                this.emitLine('"', name, '": [');
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (_caseName, jsonName) => {
                        this.emitLine(`"${utf16StringEscape(jsonName)}",`);
                    });
                });
                this.emitLine("],");
            });
        });
    };

    protected deserializerFunctionName(name: Name): Sourcelike {
        return ["to", name];
    }

    protected deserializerFunctionLine(_t: Type, name: Name): Sourcelike {
        return ["function ", this.deserializerFunctionName(name), "(json)"];
    }

    protected serializerFunctionName(name: Name): Sourcelike {
        const camelCaseName = modifySource(camelCase, name);
        return [camelCaseName, "ToJson"];
    }

    protected serializerFunctionLine(_t: Type, name: Name): Sourcelike {
        return ["function ", this.serializerFunctionName(name), "(value)"];
    }

    protected get moduleLine(): string | undefined {
        return undefined;
    }

    protected get castFunctionLine(): string {
        return "function cast(obj, typ)";
    }

    protected get typeAnnotations(): { any: string; anyArray: string; string: string; boolean: string } {
        return { any: "", anyArray: "", string: "", boolean: "" };
    }

    private emitConvertModuleBody(): void {
        this.forEachTopLevel("interposing", (t, name) => {
            this.emitBlock(this.deserializerFunctionLine(t, name), "", () => {
                if (!this._runtimeTypecheck) {
                    this.emitLine("return JSON.parse(json);");
                } else {
                    this.emitLine("return cast(JSON.parse(json), ", this.typeMapTypeFor(t), ");");
                }
            });
            this.ensureBlankLine();

            this.emitBlock(this.serializerFunctionLine(t, name), "", () => {
                this.emitLine("return JSON.stringify(value, null, 2);");
            });
        });
        if (this._runtimeTypecheck) {
            const {
                any: anyAnnotation,
                anyArray: anyArrayAnnotation,
                string: stringAnnotation,
                boolean: booleanAnnotation
            } = this.typeAnnotations;
            this.emitMultiline(`
${this.castFunctionLine} {
    if (!isValid(typ, obj)) {
        throw \`Invalid value\`;
    }
    return obj;
}

function isValid(typ${anyAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    if (typ === undefined) return true;
    if (typ === null) return val === null || val === undefined;
    return typ.isUnion  ? isValidUnion(typ.typs, val)
            : typ.isArray  ? isValidArray(typ.typ, val)
            : typ.isMap    ? isValidMap(typ.typ, val)
            : typ.isEnum   ? isValidEnum(typ.name, val)
            : typ.isObject ? isValidObject(typ.cls, val)
            :                isValidPrimitive(typ, val);
}

function isValidPrimitive(typ${stringAnnotation}, val${anyAnnotation}) {
    return typeof typ === typeof val;
}

function isValidUnion(typs${anyArrayAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    // val must validate against one typ in typs
    return typs.find(typ => isValid(typ, val)) !== undefined;
}

function isValidEnum(enumName${stringAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    const cases = typeMap[enumName];
    return cases.indexOf(val) !== -1;
}

function isValidArray(typ${anyAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    // val must be an array with no invalid elements
    return Array.isArray(val) && val.every(element => {
        return isValid(typ, element);
    });
}

function isValidMap(typ${anyAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
    // all values in the map must be typ
    return Object.keys(val).every(prop => {
        if (!Object.prototype.hasOwnProperty.call(val, prop)) return true;
        return isValid(typ, val[prop]);
    });
}

function isValidObject(className${stringAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
    let typeRep = typeMap[className];
    return Object.keys(typeRep).every(prop => {
        if (!Object.prototype.hasOwnProperty.call(typeRep, prop)) return true;
        return isValid(typeRep[prop], val[prop]);
    });
}

function a(typ${anyAnnotation}) {
    return { typ, isArray: true };
}

function e(name${stringAnnotation}) {
    return { name, isEnum: true };
}

function u(...typs${anyArrayAnnotation}) {
    return { typs, isUnion: true };
}

function m(typ${anyAnnotation}) {
    return { typ, isMap: true };
}

function o(className${stringAnnotation}) {
    return { cls: className, isObject: true };
}
`);
            this.emitTypeMap();
        }
    }

    protected emitConvertModule(): void {
        this.ensureBlankLine();
        this.emitMultiline(`// Converts JSON strings to/from your types`);
        if (this._runtimeTypecheck) {
            this.emitMultiline(`// and asserts the results of JSON.parse at runtime`);
        }
        const moduleLine = this.moduleLine;
        if (moduleLine === undefined) {
            this.emitConvertModuleBody();
        } else {
            this.emitBlock(moduleLine, "", () => this.emitConvertModuleBody());
        }
    }

    protected emitTypes(): void {
        return;
    }

    protected emitUsageImportComment(): void {
        this.emitLine('//   const Convert = require("./file");');
    }

    protected emitUsageComments(): void {
        this.emitMultiline(`// To parse this data:
//`);

        this.emitUsageImportComment();
        this.emitLine("//");
        this.forEachTopLevel("none", (_t, name) => {
            const camelCaseName = modifySource(camelCase, name);
            this.emitLine("//   const ", camelCaseName, " = Convert.to", name, "(json);");
        });
        if (this._runtimeTypecheck) {
            this.emitLine("//");
            this.emitLine("// These functions will throw an error if the JSON doesn't");
            this.emitLine("// match the expected interface, even if the JSON is valid.");
        }
    }

    protected emitModuleExports(): void {
        this.ensureBlankLine();

        this.emitBlock("module.exports =", ";", () => {
            this.forEachTopLevel("none", (_, name) => {
                const serializer = this.serializerFunctionName(name);
                const deserializer = this.deserializerFunctionName(name);
                this.emitLine('"', serializer, '": ', serializer, ",");
                this.emitLine('"', deserializer, '": ', deserializer, ",");
            });
        });
    }

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitUsageComments();
        }

        this.emitTypes();

        this.emitConvertModule();

        this.emitModuleExports();
    }
}
