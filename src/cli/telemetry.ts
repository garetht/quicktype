import * as ga from "universal-analytics";
import * as storage from "node-persist";

const GoogleAnalyticsID = "UA-102732788-5";
const uuid = require("uuid/v4");

export type TelemetryState = "none" | "disabled" | "enabled";

export interface Analytics {
    pageview(page: string): void;
    timing(category: string, variable: string, time: number): void;
    event(category: string, action: string, label?: string, value?: string | number): void;
}

class NoAnalytics implements Analytics {
    pageview(_page: string) {
        // Pass
    }

    timing(_category: string, _variable: string, _time: number) {
        // Pass
    }

    event(_category: string, _action: string, _label?: string, _value?: string | number) {
        // Pass
    }
}

class GoogleAnalytics implements Analytics {
    private readonly visitor: ga.Visitor;

    constructor() {
        this.visitor = ga(GoogleAnalyticsID, Storage.userId);
    }

    pageview(page: string): void {
        this.visitor.pageview(page).send();
    }

    timing(category: string, variable: string, time: number) {
        this.visitor.timing(category, variable, time).send();
    }

    event(category: string, action: string, label?: string, value?: string | number) {
        if (label !== undefined) {
            if (value !== undefined) {
                this.visitor.event(category, action, label, value).send();
            } else {
                this.visitor.event(category, action, label).send();
            }
        } else {
            this.visitor.event(category, action).send();
        }
    }
}

export class Telemetry implements Analytics {
    private analytics = new NoAnalytics();

    async init() {
        await storage.init();
        if (Storage.analyticsState === "enabled") {
            this.enable();
        }
    }

    pageview(page: string): void {
        this.analytics.pageview(page);
    }

    timing(category: string, variable: string, time: number) {
        this.analytics.timing(category, variable, time);
    }

    event(category: string, action: string, label?: string, value?: string | number) {
        this.analytics.event(category, action, label, value);
    }

    enable() {
        Storage.analyticsState = "enabled";
        this.analytics = new GoogleAnalytics();
    }

    disable() {
        Storage.analyticsState = "disabled";
        this.analytics = new NoAnalytics();
    }

    get state(): TelemetryState {
        return Storage.analyticsState;
    }

    set state(state: TelemetryState) {
        Storage.analyticsState = state;
    }

    async timeAsync<T>(variable: string, work: () => Promise<T>): Promise<T> {
        const start = new Date().getTime();
        const result = await work();
        const end = new Date().getTime();
        this.timing("default", variable, end - start);
        return result;
    }
}

class Storage {
    static get<T>(name: string, def: T): T {
        return storage.getItemSync(name) || def;
    }

    static set<T>(name: string, val: T) {
        storage.setItemSync(name, val);
    }

    static get userId(): string {
        return Storage.get("userId", uuid());
    }

    static get analyticsState(): TelemetryState {
        return Storage.get("analyticsState", "none");
    }

    static set analyticsState(enabled: TelemetryState) {
        Storage.set("analyticsState", enabled);
    }
}

export const telemetry = new Telemetry();

export const TELEMETRY_HEADER = `Please help improve quicktype by enabling anonymous telemetry with:

  $ quicktype --telemetry enable

You can also enable telemetry on any quicktype invocation:

  $ quicktype pokedex.json -o Pokedex.cs --telemetry enable

This helps us improve quicktype by measuring:

  * How many people use quicktype
  * Which features are popular or unpopular
  * Performance
  * Errors

quicktype does not collect:

  * Your filenames or input data
  * Any personally identifiable information (PII)
  * Anything not directly related to quicktype's usage

If you don't want to help improve quicktype, you can dismiss this message with:

  $ quicktype --telemetry disable

For a full privacy policy, visit app.quicktype.io/privacy
`;
