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
   ACTIVE STREAM
   ========================================================= */

let activeVideoId = null;


/* =========================================================
   LIKE BASELINE
   ========================================================= */

let likeBaseline = null;


/* =========================================================
   SUBSCRIBER CACHE
   ========================================================= */

let subscriberCache = {
    subscribers: 0,
    updatedAt: 0
};


/* =========================================================
   LIKE CACHE
   ========================================================= */

let likeCache = {
    likes: 0,
    updatedAt: 0
};


/* =========================================================
   YOUTUBE POLLING SETTINGS
   ========================================================= */

/*
   OBS can request our Render server frequently.

   OBS requests DO NOT directly call YouTube.

   The server controls how often YouTube is contacted.

   Subscriber count:
       Every 5 minutes

   Active stream:
       Every 60 seconds

   Stream likes:
       Every 30 seconds while live
*/

const SUBSCRIBER_POLL_TIME =
    5 * 60 * 1000;

const LIVE_POLL_TIME =
    60 * 1000;

const LIKE_POLL_TIME =
    30 * 1000;


/* =========================================================
   QUOTA BACKOFF
   ========================================================= */

/*
   If YouTube says quotaExceeded, temporarily stop
   polling instead of repeatedly retrying.
*/

const QUOTA_BACKOFF_TIME =
    15 * 60 * 1000;

let quotaBackoffUntil = 0;


/* =========================================================
   NEXT POLL TIMES
   ========================================================= */

let subscriberNextPollAt = 0;

let liveNextPollAt = 0;

let likeNextPollAt = 0;


/* =========================================================
   REFRESH LOCKS
   ========================================================= */

let subscriberPromise = null;

let livePromise = null;

let likePromise = null;


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

function calculateSubscriberGoal(
    subscribers
) {

    /*
       0   -> 50
       1   -> 50
       49  -> 50

       50  -> 100
       99  -> 100

       100 -> 150
    */

    return (
        Math.floor(
            subscribers / 50
        ) + 1
    ) * 50;
}


/* =========================================================
   LIKE GOAL
   ========================================================= */

function calculateLikeGoal(
    likes
) {

    /*
       0  -> 5
       1  -> 5
       4  -> 5

       5  -> 10
       9  -> 10

       10 -> 15
    */

    return (
        Math.floor(
            likes / 5
        ) + 1
    ) * 5;
}


/* =========================================================
   HOME
   ========================================================= */

app.get("/", (req, res) => {

    res.json({

        status: "online",

        service:
            "Satoshi's Franchise Stream Counter",

        channelId:
            YOUTUBE_CHANNEL_ID ||
            "not configured",

        features: [
            "YouTube subscribers",
            "Automatic active stream detection",
            "Automatic video ID detection",
            "Stream likes",
            "Dynamic subscriber goals",
            "Dynamic like goals",
            "Quota protected polling"
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
   CHECK FOR QUOTA ERROR
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
   HANDLE YOUTUBE ERRORS
   ========================================================= */

function handleYouTubeError(
    error,
    operation
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
            `Operation: ${operation}`
        );

        console.error(
            `Polling paused for ${
                QUOTA_BACKOFF_TIME / 60000
            } minutes.`
        );

        console.error(
            "================================="
        );

        return;
    }

    console.error(
        `YouTube ${operation} error:`,
        error
    );
}


/* =========================================================
   FIND ACTIVE YOUTUBE BROADCAST
   ========================================================= */

/*
   Finds active broadcasts belonging to the
   authenticated Google/YouTube account.

   Then we check the channel ID to make sure
   the stream belongs to Satoshi's Franchise.
*/

async function findActiveBroadcast() {

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
        await youtube.liveBroadcasts.list({

            part: [
                "id",
                "snippet",
                "status"
            ],

            broadcastStatus:
                "active",

            mine:
                true,

            maxResults:
                50

        });

    const items =
        response.data.items || [];

    const broadcast =
        items.find(
            item =>
                item.snippet?.channelId ===
                YOUTUBE_CHANNEL_ID
        );

    if (!broadcast) {
        return null;
    }

    return {

        id:
            broadcast.id,

        title:
            broadcast.snippet?.title || "",

        channelId:
            broadcast.snippet?.channelId || ""

    };
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

    /*
       Safety check.
    */

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
   FETCH VIDEO LIKES
   ========================================================= */

async function fetchVideoLikes(
    videoId
) {

    const client =
        getAuthenticatedClient();

    if (!client) {

        throw new Error(
            "YouTube OAuth is not configured"
        );
    }

    if (!videoId) {

        throw new Error(
            "Video ID is missing"
        );
    }

    const youtube =
        google.youtube({
            version: "v3",
            auth: client
        });

    const response =
        await youtube.videos.list({

            part: [
                "statistics"
            ],

            id: [
                videoId
            ]

        });

    const items =
        response.data.items || [];

    if (
        items.length === 0
    ) {

        throw new Error(
            "Live video not found"
        );
    }

    return Number(
        items[0]
            .statistics
            ?.likeCount || 0
    );
}


/* =========================================================
   REFRESH SUBSCRIBERS
   ========================================================= */

async function refreshSubscribers() {

    if (subscriberPromise) {
        return subscriberPromise;
    }

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
                    error,
                    "subscriber refresh"
                );

                /*
                   Do not immediately retry.
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
   REFRESH ACTIVE STREAM
   ========================================================= */

async function refreshActiveStream() {

    if (livePromise) {
        return livePromise;
    }

    if (
        Date.now() <
        quotaBackoffUntil
    ) {
        return;
    }

    livePromise =
        (async () => {

            try {

                const broadcast =
                    await findActiveBroadcast();

                liveNextPollAt =
                    Date.now() +
                    LIVE_POLL_TIME;


                /* =========================================
                   NO ACTIVE STREAM
                   ========================================= */

                if (!broadcast) {

                    if (
                        activeVideoId !==
                        null
                    ) {

                        console.log(
                            "Stream ended."
                        );

                    }

                    activeVideoId =
                        null;

                    likeBaseline =
                        null;

                    likeCache = {

                        likes:
                            0,

                        updatedAt:
                            Date.now()

                    };

                    likeNextPollAt =
                        0;

                    return;
                }


                /* =========================================
                   NEW STREAM
                   ========================================= */

                if (
                    activeVideoId !==
                    broadcast.id
                ) {

                    console.log(
                        "================================="
                    );

                    console.log(
                        "NEW STREAM DETECTED"
                    );

                    console.log(
                        "VIDEO ID:",
                        broadcast.id
                    );

                    console.log(
                        "TITLE:",
                        broadcast.title
                    );

                    console.log(
                        "CHANNEL ID:",
                        broadcast.channelId
                    );

                    console.log(
                        "================================="
                    );


                    /*
                       Save the new stream ID.
                    */

                    activeVideoId =
                        broadcast.id;


                    /*
                       Get total likes at the moment
                       the stream is detected.

                       Example:

                       YouTube likes = 127

                       Baseline = 127

                       Stream likes = 0
                    */

                    const startingLikes =
                        await fetchVideoLikes(
                            activeVideoId
                        );

                    likeBaseline =
                        startingLikes;


                    /*
                       Reset stream likes.
                    */

                    likeCache = {

                        likes:
                            0,

                        updatedAt:
                            Date.now()

                    };


                    /*
                       Next like check after 30 seconds.
                    */

                    likeNextPollAt =
                        Date.now() +
                        LIKE_POLL_TIME;


                    console.log(
                        "Like baseline:",
                        likeBaseline
                    );

                    return;
                }

            } catch (error) {

                handleYouTubeError(
                    error,
                    "active stream refresh"
                );

                liveNextPollAt =
                    Date.now() +
                    LIVE_POLL_TIME;

            } finally {

                livePromise =
                    null;
            }

        })();

    return livePromise;
}


/* =========================================================
   REFRESH STREAM LIKES
   ========================================================= */

async function refreshLikes() {

    if (likePromise) {
        return likePromise;
    }

    if (
        Date.now() <
        quotaBackoffUntil
    ) {
        return;
    }

    if (!activeVideoId) {
        return;
    }

    if (
        likeBaseline ===
        null
    ) {
        return;
    }

    likePromise =
        (async () => {

            try {

                const currentLikes =
                    await fetchVideoLikes(
                        activeVideoId
                    );


                /*
                   Calculate likes gained
                   during the current stream.
                */

                const streamLikes =
                    Math.max(
                        0,
                        currentLikes -
                            likeBaseline
                    );


                likeCache = {

                    likes:
                        streamLikes,

                    updatedAt:
                        Date.now()

                };


                likeNextPollAt =
                    Date.now() +
                    LIKE_POLL_TIME;


                console.log(
                    "Stream likes:",
                    streamLikes
                );

            } catch (error) {

                handleYouTubeError(
                    error,
                    "like refresh"
                );

                likeNextPollAt =
                    Date.now() +
                    LIKE_POLL_TIME;

            } finally {

                likePromise =
                    null;
            }

        })();

    return likePromise;
}


/* =========================================================
   UPDATE YOUTUBE DATA IF NEEDED
   ========================================================= */

async function updateYouTubeDataIfNeeded() {

    const now =
        Date.now();


    /*
       If quota backoff is active,
       don't contact YouTube.
    */

    if (
        now <
        quotaBackoffUntil
    ) {
        return;
    }


    /* =========================================
       SUBSCRIBERS
       ========================================= */

    if (
        now >=
        subscriberNextPollAt
    ) {

        await refreshSubscribers();
    }


    /* =========================================
       ACTIVE STREAM
       ========================================= */

    if (
        now >=
        liveNextPollAt
    ) {

        await refreshActiveStream();
    }


    /* =========================================
       STREAM LIKES
       ========================================= */

    if (
        activeVideoId &&
        likeBaseline !== null &&
        now >= likeNextPollAt
    ) {

        await refreshLikes();
    }
}


/* =========================================================
   BACKGROUND POLLER
   ========================================================= */

/*
   Check whether any YouTube data needs updating
   every 5 seconds.

   IMPORTANT:

   This does NOT mean YouTube is contacted every
   5 seconds.

   The individual polling timers above control that.
*/

setInterval(
    () => {

        updateYouTubeDataIfNeeded()
            .catch(error => {

                console.error(
                    "Background YouTube poll error:",
                    error
                );

            });

    },
    5000
);


/* =========================================================
   INITIAL YOUTUBE CHECK
   ========================================================= */

setTimeout(
    () => {

        updateYouTubeDataIfNeeded()
            .catch(error => {

                console.error(
                    "Initial YouTube poll error:",
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
   OBS gets cached subscriber data.

   It does NOT force a YouTube API request.
*/

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

            await updateYouTubeDataIfNeeded();

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
   LIKE API
   ========================================================= */

app.get(
    "/api/youtube/likes",
    async (req, res) => {

        try {

            await updateYouTubeDataIfNeeded();

            const likes =
                likeCache.likes;

            const likeGoal =
                calculateLikeGoal(
                    likes
                );

            res.json({

                likes:
                    likes,

                likeGoal:
                    likeGoal,

                videoId:
                    activeVideoId,

                live:
                    Boolean(
                        activeVideoId
                    ),

                updatedAt:
                    likeCache.updatedAt
                        ? new Date(
                            likeCache.updatedAt
                        ).toISOString()
                        : null

            });

        } catch (error) {

            console.error(
                "Like endpoint error:",
                error
            );

            res.status(500).json({

                error:
                    "Unable to get likes"

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
            "Satoshi's Franchise Counter"
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
            "Subscriber polling: 5 minutes"
        );

        console.log(
            "Live polling: 60 seconds"
        );

        console.log(
            "Like polling: 30 seconds"
        );

        console.log(
            "================================="
        );

    }
);