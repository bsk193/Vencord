/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Switch } from "@components/Switch";
import { Devs } from "@utils/constants";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Button, Forms, showToast, Toasts, useState, React } from "@webpack/common";

interface Activity {
    id: string;
    name: string;
    type: number;
    enabled: boolean;
}

const RunningGameStore = findStoreLazy("RunningGameStore");
const PresenceStore = findStoreLazy("PresenceStore");
const UserStore = findStoreLazy("UserStore");

// Helper functions for activity persistence
function getStoredActivities(): Activity[] {
    try {
        const stored = settings.store.activitiesData;
        if (!stored) return [];
        const parsed = JSON.parse(stored) as Activity[];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveActivities(activities: Activity[]) {
    try {
        const serialized = JSON.stringify(activities);
        settings.store.activitiesData = serialized;
    } catch (e) {
        console.error("ActivityFilterPlus: Error saving activities:", e);
    }
}

// Debounce function to prevent rate limiting
let debounceTimer: NodeJS.Timeout;
function debounceRecalculate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        try {
            const currentUser = UserStore.getCurrentUser();
            if (currentUser) {
                PresenceStore.emitChange();
                setTimeout(() => PresenceStore.emitChange(), 100);
            }
        } catch (e) {
            // Silent error handling
        }
    }, 100);
}

function ActivityToggleComponent(props?: { setValue?: (value: any) => void; option?: any; }) {
    const [activities, setActivities] = useState<Activity[]>(() => {
        return getStoredActivities();
    });
    const s = settings.use(["activitiesData"]);

    // Sync component state with settings when settings change externally
    React.useEffect(() => {
        const stored = getStoredActivities();
        if (JSON.stringify(stored) !== JSON.stringify(activities)) {
            setActivities(stored);
        }
    }, [s.activitiesData]);

    const detectCurrentActivities = () => {
        const detectedActivities: Activity[] = [];

        try {
            const currentUser = UserStore.getCurrentUser();
            if (currentUser) {
                const userActivities = PresenceStore.getActivities(currentUser.id);

                userActivities.forEach((activity: any) => {
                    const activityId = activity.application_id || activity.name;
                    if (activityId) {
                        const storedActivities = getStoredActivities();
                        const existingActivity = storedActivities.find(a => a.id === activityId);

                        detectedActivities.push({
                            id: activityId,
                            name: activity.name || "Unknown Activity",
                            type: activity.type || 0,
                            enabled: existingActivity ? existingActivity.enabled : true
                        });
                    }
                });

                const runningGames = RunningGameStore.getRunningGames();
                runningGames.forEach((game: any) => {
                    // Use exePath as primary ID for games if available (more unique)
                    // Otherwise fall back to game.id or game.name
                    const activityId = game.exePath || game.id || game.name;
                    if (activityId && !detectedActivities.some(a => a.id === activityId)) {
                        const storedActivities = getStoredActivities();
                        // Check for existing activity by this ID, or by alternative IDs (game.id, game.name, exePath)
                        const existingActivity = storedActivities.find(a =>
                            a.id === activityId ||
                            a.id === game.id ||
                            a.id === game.name ||
                            a.id === game.exePath
                        );

                        detectedActivities.push({
                            id: activityId,
                            name: game.name || "Unknown Game",
                            type: 0,
                            enabled: existingActivity ? existingActivity.enabled : true
                        });
                    }
                });
            }
        } catch (e) {
            console.error("ActivityFilterPlus: Error detecting activities:", e);
        }

        // Preserve existing activities - never lose them
        const existingActivities = [...getStoredActivities()];

        // Update existing activities with current status but preserve enabled state
        existingActivities.forEach(existing => {
            const currentActivity = detectedActivities.find(a => a.id === existing.id);
            if (currentActivity) {
                existing.name = currentActivity.name;
                existing.type = currentActivity.type;
            }
        });

        // Add new activities
        const newActivities = detectedActivities.filter(detected =>
            !existingActivities.some(existing => existing.id === detected.id)
        );

        const allActivities = [...existingActivities, ...newActivities];

        setActivities(allActivities);
        saveActivities(allActivities);

        if (newActivities.length > 0) {
            showToast(`Added ${newActivities.length} new activities to permanent list!`, Toasts.Type.SUCCESS);
        } else {
            showToast("Activity list updated - no new activities found", Toasts.Type.SUCCESS);
        }

        debounceRecalculate();
    };

    const toggleActivity = (activityId: string) => {
        const updatedActivities = activities.map(activity => {
            if (activity.id === activityId) {
                return { ...activity, enabled: !activity.enabled };
            }
            return activity;
        });

        setActivities(updatedActivities);
        saveActivities(updatedActivities);
        debounceRecalculate();

        const activity = updatedActivities.find(a => a.id === activityId);
        showToast(`${activity?.name} ${activity?.enabled ? 'enabled' : 'disabled'}`, Toasts.Type.SUCCESS);
    };

    const removeActivity = (activityId: string) => {
        const updatedActivities = activities.filter(activity => activity.id !== activityId);
        setActivities(updatedActivities);
        saveActivities(updatedActivities);
        showToast("Activity removed!", Toasts.Type.SUCCESS);
        debounceRecalculate();
    };

    const clearAllActivities = () => {
        setActivities([]);
        saveActivities([]);
        showToast("All activities cleared!", Toasts.Type.SUCCESS);
        debounceRecalculate();
    };

    const getActivityTypeText = (type: number) => {
        switch (type) {
            case 0: return "Playing";
            case 1: return "Streaming";
            case 2: return "Listening";
            case 3: return "Watching";
            case 4: return "Custom Status";
            case 5: return "Competing";
            default: return "Unknown";
        }
    };

    const getActivityTypeEmoji = (type: number) => {
        switch (type) {
            case 0: return "🎮";
            case 1: return "📺";
            case 2: return "🎵";
            case 3: return "👀";
            case 4: return "💭";
            case 5: return "🏆";
            default: return "❓";
        }
    };

    // Get currently running activities for "RUNNING" badge
    const getCurrentlyRunningIds = () => {
        try {
            const currentUser = UserStore.getCurrentUser();
            if (currentUser) {
                const userActivities = PresenceStore.getActivities(currentUser.id);
                const runningIds = new Set();

                userActivities.forEach((activity: any) => {
                    const activityId = activity.application_id || activity.name;
                    if (activityId) runningIds.add(activityId);
                });

                const runningGames = RunningGameStore.getRunningGames();
                runningGames.forEach((game: any) => {
                    const activityId = game.id || game.name;
                    if (activityId) runningIds.add(activityId);
                });

                return runningIds;
            }
        } catch (e) {
            // Silent error handling
        }
        return new Set();
    };

    const currentlyRunning = getCurrentlyRunningIds();

    return (
        <section>
            <Forms.FormTitle tag="h5">Detected Activities</Forms.FormTitle>

            <Button
                onClick={detectCurrentActivities}
                color={Button.Colors.BRAND}
                size={Button.Sizes.SMALL}
                style={{ marginBottom: "12px" }}
            >
                Detect
            </Button>

            {activities.length === 0 ? (
                <Forms.FormText style={{ fontStyle: "italic", marginTop: "8px" }}>
                    No activities detected yet.
                </Forms.FormText>

            ) : (
                <div style={{ marginTop: "12px" }}>
                    {activities.map(activity => (
                        <div
                            key={activity.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                marginBottom: "8px",
                                border: `2px solid ${activity.enabled ? "var(--green-300)" : "var(--red-400)"}`,
                                borderRadius: "6px",
                                backgroundColor: "var(--background-secondary-alt)"
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                                <span style={{ fontSize: "16px" }}>
                                    {getActivityTypeEmoji(activity.type)}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        fontWeight: "500",
                                        color: "white",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px"
                                    }}>
                                        {activity.name}
                                        {currentlyRunning.has(activity.id) && (
                                            <span style={{
                                                backgroundColor: "var(--green-400)",
                                                color: "white",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                fontSize: "10px",
                                                fontWeight: "bold"
                                            }}>
                                                RUNNING
                                            </span>
                                        )}
                                    </div>
                                    <div style={{
                                        fontSize: "12px",
                                        color: "var(--text-muted)",
                                        marginTop: "2px"
                                    }}>
                                        {getActivityTypeText(activity.type)} • ID: {activity.id}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <Switch
                                    checked={activity.enabled}
                                    onChange={(_checked: boolean) => toggleActivity(activity.id)}
                                />
                                <Button
                                    color={Button.Colors.RED}
                                    size={Button.Sizes.SMALL}
                                    onClick={() => removeActivity(activity.id)}
                                >
                                    ×
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activities.length > 0 && (
                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                    <Button
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        onClick={clearAllActivities}
                    >
                        Clear
                    </Button>
                    <Button
                        color={Button.Colors.GREEN}
                        size={Button.Sizes.SMALL}
                        onClick={() => {
                            const updatedActivities = activities.map(a => ({ ...a, enabled: true }));
                            setActivities(updatedActivities);
                            saveActivities(updatedActivities);
                            showToast("All activities enabled!", Toasts.Type.SUCCESS);
                            debounceRecalculate();
                        }}
                    >
                        Show All
                    </Button>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        onClick={() => {
                            const updatedActivities = activities.map(a => ({ ...a, enabled: false }));
                            setActivities(updatedActivities);
                            saveActivities(updatedActivities);
                            showToast("All activities disabled!", Toasts.Type.SUCCESS);
                            debounceRecalculate();
                        }}
                    >
                        Hide All
                    </Button>
                </div>
            )}
        </section>
    );
}

const settings = definePluginSettings({
    activityToggles: {
        type: OptionType.COMPONENT,
        component: ActivityToggleComponent
    },
    hidePlayingActivities: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: debounceRecalculate
    },
    hideStreamingActivities: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: debounceRecalculate
    },
    hideListeningActivities: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: debounceRecalculate
    },
    hideWatchingActivities: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: debounceRecalculate
    },
    hideCustomStatus: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: debounceRecalculate
    },
    hideCompetingActivities: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: debounceRecalculate
    },
    /*     
    activitiesData: {
        type: OptionType.STRING,
        description: "",
        default: ""
    } */
});

function isActivityNotIgnored(props: { type: number; application_id?: string; name?: string; }) {
    // Check if activity type is globally hidden (these override individual settings)
    switch (props.type) {
        case 0:
            if (settings.store.hidePlayingActivities) return false;
            break;
        case 1:
            if (settings.store.hideStreamingActivities) return false;
            break;
        case 2:
            if (settings.store.hideListeningActivities) return false;
            break;
        case 3:
            if (settings.store.hideWatchingActivities) return false;
            break;
        case 4:
            if (settings.store.hideCustomStatus) return false;
            break;
        case 5:
            if (settings.store.hideCompetingActivities) return false;
            break;
    }

    // Only check individual activity settings if global setting for this type is not enabled
    const storedActivities = getStoredActivities();

    // First check by application_id if available
    if (props.application_id != null) {
        const activity = storedActivities.find(a => a.id === props.application_id);
        if (activity && !activity.enabled) return false;
    }

    // Also check by name (for activities without application_id or as fallback)
    if (props.name != null) {
        const activity = storedActivities.find(a => a.id === props.name);
        if (activity && !activity.enabled) return false;
    }

    // For games (type 0), also check by exePath
    if (props.type === 0) {
        try {
            const runningGames = RunningGameStore.getRunningGames();
            const matchingGame = runningGames.find(game =>
                (props.application_id && game.id === props.application_id) ||
                (props.name && game.name === props.name)
            );

            if (matchingGame?.exePath) {
                const activity = storedActivities.find(a => a.id === matchingGame.exePath);
                if (activity && !activity.enabled) return false;
            }
        } catch (e) {
            // Silent error handling
        }
    }

    return true; // Return true to ALLOW this activity
}

export default definePlugin({
    name: "ActivityFilterPlus",
    authors: [Devs.bloom62],
    description: "",
    dependencies: ["UserSettingsAPI"],

    settings,

    patches: [
        {
            find: '"LocalActivityStore"',
            replacement: [
                {
                    match: /\.LISTENING.+?(?=!?\i\(\)\(\i,\i\))(?<=(\i)\.push.+?)/,
                    replace: (m, activities) => `${m}${activities}=${activities}.filter($self.isActivityNotIgnored);`
                }
            ]
        },
        {
            find: '"ActivityTrackingStore"',
            replacement: {
                match: /getVisibleRunningGames\(\).+?;(?=for)(?<=(\i)=\i\.\i\.getVisibleRunningGames.+?)/,
                replace: (m, runningGames) => `${m}${runningGames}=${runningGames}.filter(({id,name})=>$self.isActivityNotIgnored({type:0,application_id:id,name}));`
            }
        },
        {
            find: '"PresenceStore"',
            replacement: {
                match: /(getActivities\(\).+?return\s+)(.+?)(\s*;)/,
                replace: (m, prefix, activities, suffix) => `${prefix}${activities}.filter($self.isActivityNotIgnored)${suffix}`
            }
        },
        {
            find: ".activities=",
            replacement: {
                match: /\.activities\s*=\s*(\i)\.activities/,
                replace: (m, presence) => `.activities=${presence}.activities?.filter($self.isActivityNotIgnored)||[]`
            }
        }
    ],

    start() {
        // Ensure activities array exists
        if (!settings.store.activitiesData) {
            settings.store.activitiesData = "";
        }

        // Force presence update when plugin starts
        setTimeout(() => {
            try {
                const currentUser = UserStore.getCurrentUser();
                if (currentUser) {
                    PresenceStore.emitChange();
                }
            } catch (e) {
                // Silent error handling
            }
        }, 1000);
    },

    stop() {
        // Clear any debounce timers
        clearTimeout(debounceTimer);
    },

    isActivityNotIgnored
}); 