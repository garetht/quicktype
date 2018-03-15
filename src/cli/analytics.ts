import * as ga from "universal-analytics";
import * as storage from "node-persist";

const GoogleAnalyticsID = "UA-102732788-5";
const uuid = require("uuid/v4");

export type AnalyticsState = "none" | "disabled" | "enabled";

export interface Analytics {
    pageview(page: string): void;
}

class NoAnalytics implements Analytics {
    pageview(_page: string): void {
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

    static get analyticsState(): AnalyticsState {
        return Storage.get("analyticsState", "none");
    }

    static set analyticsState(enabled: AnalyticsState) {
        Storage.set("analyticsState", enabled);
    }
}

let analytics: Analytics;

export async function init() {
    await storage.init();
    const state = Storage.analyticsState;
    analytics = state === "enabled" ? new GoogleAnalytics() : new NoAnalytics();
    return state;
}

export function pageview(page: string) {
    analytics.pageview(page);
}

export function setState(state: AnalyticsState) {
    Storage.analyticsState = state;
}
