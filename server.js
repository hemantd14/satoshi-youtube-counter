const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;


/* =========================================================
   YOUTUBE CHANNEL CONFIGURATION
   ========================================================= */

const YOUTUBE_CHANNEL_ID =
    process.env.YOUTUBE_CHANNEL_ID;


/* =========================================================
   GOOGLE OAUTH CONFIGURATION
   ========================================================= */

const GOOGLE_CLIENT_ID =
    process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET;

const YOUTUBE_REFRESH_TOKEN =
    process.env.YOUTUBE_REFRESH_TOKEN;


/* =========================================================
   GOOGLE OAUTH CLIENT
   ========================================================= */

const oauth2Client =
    new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET
    );


/* =========================================================
   SUBSCRIBER CACHE
   ========================================================= */

let subscriberCache = {
    subscribers: 0,
    updatedAt: 0
};


/* =========================================================
   SUBSCRIBER POLLING
   ========================================================= */

/*
   YouTube subscriber count is checked once every minute.

   OBS/browser requests only read the cached value.

   OBS does NOT directly call YouTube.
*/

const SUBSCRIBER_POLL_TIME =
    60 * 1000;


/* =========================================================
   QUOTA BACKOFF
   ========================================================= */

/*
   If YouTube reports quotaExceeded,
   stop polling temporarily instead of repeatedly
   sending requests.
*/

const QUOTA_BACKOFF_TIME =
    15 * 60 * 1000;

let quotaBackoffUntil = 0;


/* =========================================================
   NEXT SUBSCRIBER POLL
   ========================================================= */

let subscriberNextPollAt = 0;


/* =========================================================
   REFRESH LOCK
   ========================================================= */

let subscriberPromise = null;


/* =========================================================
   AUTHENTICATED YOUTUBE CLIENT
   ========================================================= */

function getAuthenticatedClient() {

    if (
        !GOOGLE_CLIENT_ID ||
        !GOOGLE_CLIENT_SECRET ||
        !YOUTUBE_REFRESH_TOKEN
    ) {
        return null;
    }

    oauth2Client.setCredentials({
        refresh_token:
            YOUTUBE_REFRESH_TOKEN
    });

    return oauth2Client;
}


/* =========================================================
   SUBSCRIBER GOAL
   ========================================================= */

/*
   Examples:

   0   -> 50
   1   -> 50
   49  -> 50

   50  -> 100
   87  -> 100
   99  -> 100

   100 -> 150
   150 -> 200
*/

function calculateSubscriberGoal(
    subscribers
) {

    return (
        Math.floor(
            subscribers / 50
        ) + 1
    ) * 50;
}


/* =========================================================
   HOME
   ========================================================= */

app.get("/", (req, res) => {

    res.json({

        status:
            "online",

        service:
            "Satoshi's Franchise Subscriber Counter",

        channelId:
            YOUTUBE_CHANNEL_ID ||
            "not configured",

        features: [
            "YouTube subscribers",
            "Dynamic subscriber goals",
            "Cached YouTube requests",
            "Quota protection"
        ]

    });

});


/* =========================================================
   OBS OVERLAY
   ========================================================= */

app.get("/overlay", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "Sub counter.html"
        )
    );

});


/* =========================================================
   QUOTA ERROR CHECK
   ========================================================= */

function isQuotaExceeded(error) {

    return (
        error?.code === 403 &&
        (
            error?.errors?.some(
                item =>
                    item?.reason ===
                    "quotaExceeded"
            ) ||
            error?.response?.data?.error?.errors?.some(
                item =>
                    item?.reason ===
                    "quotaExceeded"
            )
        )
    );
}


/* =========================================================
   YOUTUBE ERROR HANDLER
   ========================================================= */

function handleYouTubeError(
    error
) {

    if (
        isQuotaExceeded(error)
    ) {

        quotaBackoffUntil =
            Date.now() +
            QUOTA_BACKOFF_TIME;

        console.error(
            "================================="
        );

        console.error(
            "YOUTUBE QUOTA EXCEEDED"
        );

        console.error(
            "Subscriber polling paused for 15 minutes."
        );

        console.error(
            "================================="
        );

        return;
    }

    console.error(
        "YouTube subscriber error:",
        error
    );
}


/* =========================================================
   FETCH SATOSHI'S FRANCHISE SUBSCRIBERS
   ========================================================= */

async function fetchSubscribers() {

    const client =
        getAuthenticatedClient();

    if (!client) {

        throw new Error(
            "YouTube OAuth is not configured"
        );
    }

    if (!YOUTUBE_CHANNEL_ID) {

        throw new Error(
            "YOUTUBE_CHANNEL_ID is not configured"
        );
    }

    const youtube =
        google.youtube({
            version: "v3",
            auth: client
        });


    const response =
        await youtube.channels.list({

            part: [
                "snippet",
                "statistics"
            ],

            id: [
                YOUTUBE_CHANNEL_ID
            ]

        });


    const items =
        response.data.items || [];


    if (
        items.length === 0
    ) {

        throw new Error(
            "Satoshi's Franchise channel not found"
        );
    }


    const channel =
        items[0];


    /* =========================================
       SAFETY CHECK
       ========================================= */

    if (
        channel.id !==
        YOUTUBE_CHANNEL_ID
    ) {

        throw new Error(
            "YouTube returned an unexpected channel"
        );
    }


    const subscriberCount =
        channel.statistics
            ?.subscriberCount;


    if (
        subscriberCount ===
            undefined ||
        subscriberCount ===
            null
    ) {

        throw new Error(
            "YouTube did not return subscriberCount"
        );
    }


    console.log(
        "================================="
    );

    console.log(
        "CHANNEL:",
        channel.snippet?.title ||
            "Unknown"
    );

    console.log(
        "CHANNEL ID:",
        channel.id
    );

    console.log(
        "SUBSCRIBERS:",
        subscriberCount
    );

    console.log(
        "================================="
    );


    return Number(
        subscriberCount
    );
}


/* =========================================================
   REFRESH SUBSCRIBERS
   ========================================================= */

async function refreshSubscribers() {

    /*
       Prevent multiple simultaneous requests.
    */

    if (
        subscriberPromise
    ) {

        return subscriberPromise;
    }


    /*
       Don't contact YouTube while quota
       backoff is active.
    */

    if (
        Date.now() <
        quotaBackoffUntil
    ) {

        return;
    }


    subscriberPromise =
        (async () => {

            try {

                const subscribers =
                    await fetchSubscribers();


                subscriberCache = {

                    subscribers:
                        subscribers,

                    updatedAt:
                        Date.now()

                };


                subscriberNextPollAt =
                    Date.now() +
                    SUBSCRIBER_POLL_TIME;


                console.log(
                    "Subscriber count updated:",
                    subscribers
                );


            } catch (error) {

                handleYouTubeError(
                    error
                );


                /*
                   Don't immediately retry.
                */

                subscriberNextPollAt =
                    Date.now() +
                    SUBSCRIBER_POLL_TIME;


            } finally {

                subscriberPromise =
                    null;

            }

        })();


    return subscriberPromise;
}


/* =========================================================
   UPDATE SUBSCRIBER DATA IF NEEDED
   ========================================================= */

async function updateSubscriberIfNeeded() {

    const now =
        Date.now();


    /*
       Quota backoff active.
    */

    if (
        now <
        quotaBackoffUntil
    ) {

        return;
    }


    /*
       Time for another subscriber request?
    */

    if (
        now >=
        subscriberNextPollAt
    ) {

        await refreshSubscribers();

    }

}


/* =========================================================
   BACKGROUND SUBSCRIBER POLLER
   ========================================================= */

/*
   This checks the timer every 5 seconds.

   IMPORTANT:

   YouTube is NOT contacted every 5 seconds.

   The actual YouTube request happens only
   once every SUBSCRIBER_POLL_TIME.
*/

setInterval(
    () => {

        updateSubscriberIfNeeded()
            .catch(error => {

                console.error(
                    "Background subscriber error:",
                    error
                );

            });

    },
    5000
);


/* =========================================================
   INITIAL SUBSCRIBER CHECK
   ========================================================= */

setTimeout(
    () => {

        updateSubscriberIfNeeded()
            .catch(error => {

                console.error(
                    "Initial subscriber error:",
                    error
                );

            });

    },
    2000
);


/* =========================================================
   SUBSCRIBER API
   ========================================================= */

/*
   OBS reads the cached subscriber count.

   This endpoint does NOT directly call YouTube.
*/

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

            await updateSubscriberIfNeeded();


            const subscribers =
                subscriberCache.subscribers;


            const subscriberGoal =
                calculateSubscriberGoal(
                    subscribers
                );


            res.json({

                subscribers:
                    subscribers,

                subscriberGoal:
                    subscriberGoal,

                updatedAt:
                    subscriberCache.updatedAt
                        ? new Date(
                            subscriberCache.updatedAt
                        ).toISOString()
                        : null

            });


        } catch (error) {

            console.error(
                "Subscriber endpoint error:",
                error
            );


            res.status(500).json({

                error:
                    "Unable to get subscribers"

            });

        }

    }
);


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            "Satoshi's Franchise Subscriber Counter"
        );

        console.log(
            "Server running on port:",
            PORT
        );

        console.log(
            "Channel ID:",
            YOUTUBE_CHANNEL_ID ||
            "NOT CONFIGURED"
        );

        console.log(
            "Subscriber polling: 1 minute"
        );

        console.log(
            "Like counter: DISABLED"
        );

        console.log(
            "================================="
        );

    }
);