const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;


/* =========================================================
   YOUTUBE CHANNEL CONFIGURATION
   ========================================================= */

/*
   This is the exact Satoshi's Franchise channel ID.
*/

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

/*
   Example:

   Stream video has 127 total likes
   when detected.

   Baseline = 127

   Later:

   Video = 132 likes

   Stream likes = 132 - 127
                = 5
*/

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
   YOUTUBE CACHE
   ========================================================= */

/*
   OBS may request our server every second.

   We DO NOT request YouTube every second.

   YouTube is contacted once every 30 seconds.
*/

const YOUTUBE_CACHE_TIME = 30000;


/* =========================================================
   REFRESH LOCK
   ========================================================= */

/*
   Prevents multiple OBS requests from triggering
   multiple simultaneous YouTube refreshes.
*/

let refreshPromise = null;


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
   84  -> 100
   99  -> 100

   100 -> 150
   149 -> 150

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
   LIKE GOAL
   ========================================================= */

/*
   Examples:

   0  -> 5
   1  -> 5
   4  -> 5

   5  -> 10
   9  -> 10

   10 -> 15
*/

function calculateLikeGoal(
    likes
) {

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
            YOUTUBE_CHANNEL_ID || "not configured",

        features: [
            "YouTube subscribers",
            "Automatic active stream detection",
            "Automatic video ID detection",
            "Stream likes",
            "Dynamic subscriber goals",
            "Dynamic like goals"
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
   FIND ACTIVE YOUTUBE BROADCAST
   ========================================================= */

/*
   We use:

   broadcastStatus = active
   mine = true

   This finds active broadcasts belonging to
   the authenticated Google/YouTube account.

   Then we verify that the broadcast's channelId
   matches:

   YOUTUBE_CHANNEL_ID

   This prevents another YouTube channel owned by
   the same Google account from being selected.
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


    /*
       Find the active broadcast belonging
       specifically to Satoshi's Franchise.
    */

    const broadcast =
        items.find(
            item =>
                item.snippet?.channelId ===
                YOUTUBE_CHANNEL_ID
        );


    /*
       No Satoshi's Franchise stream is live.
    */

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

/*
   IMPORTANT:

   We use the exact channel ID.

   No API key is required.

   No YOUTUBE_API_KEY is used.
*/

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

    console.log(
        "================================="
    );

    console.log(
        "YOUTUBE CHANNEL API RESPONSE:"
    );

    console.log(
        JSON.stringify(
            response.data,
            null,
            2
        )
    );

    console.log(
        "=================================",
    );

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

    console.log(
        "Channel title:",
        channel.snippet?.title
    );

    console.log(
        "Channel ID:",
        channel.id
    );

    console.log(
        "Statistics:",
        channel.statistics
    );

    console.log(
        "Subscriber count:",
        channel.statistics?.subscriberCount
    );

    console.log(
        "Hidden subscriber count:",
        channel.statistics?.hiddenSubscriberCount
    );

    if (
        channel.id !==
        YOUTUBE_CHANNEL_ID
    ) {
        throw new Error(
            "YouTube returned an unexpected channel"
        );
    }

    if (
        channel.statistics?.subscriberCount ===
        undefined ||
        channel.statistics?.subscriberCount ===
        null
    ) {
        throw new Error(
            "YouTube did not return subscriberCount"
        );
    }

    return Number(
        channel.statistics.subscriberCount
    );
}


/* =========================================================
   FETCH VIDEO LIKES
   ========================================================= */

/*
   Retrieves the total likes for the automatically
   detected livestream video.

   videos.list statistics.likeCount is used here.
*/

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
   REFRESH YOUTUBE DATA
   ========================================================= */

async function refreshYouTubeData() {

    /*
       If another refresh is already running,
       wait for that refresh instead of starting
       another one.
    */

    if (refreshPromise) {

        return refreshPromise;

    }


    refreshPromise =
        (async () => {

            try {

                /* =========================================
                   1. FETCH SUBSCRIBERS
                   ========================================= */

                const subscribers =
                    await fetchSubscribers();


                subscriberCache = {

                    subscribers:
                        subscribers,

                    updatedAt:
                        Date.now()

                };


                /* =========================================
                   2. FIND ACTIVE STREAM
                   ========================================= */

                const broadcast =
                    await findActiveBroadcast();


                /* =========================================
                   3. NO ACTIVE STREAM
                   ========================================= */

                if (!broadcast) {

                    /*
                       There is currently no live stream.

                       Reset stream-specific data.
                    */

                    activeVideoId =
                        null;

                    likeBaseline =
                        null;

                    likeCache = {

                        likes: 0,

                        updatedAt:
                            Date.now()

                    };


                    console.log(
                        "No active Satoshi's Franchise stream."
                    );


                    return;

                }


                /* =========================================
                   4. NEW STREAM DETECTED
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
                        "Video ID:",
                        broadcast.id
                    );


                    console.log(
                        "Title:",
                        broadcast.title
                    );


                    console.log(
                        "Channel ID:",
                        broadcast.channelId
                    );


                    console.log(
                        "================================="
                    );


                    /*
                       Save new video ID.
                    */

                    activeVideoId =
                        broadcast.id;


                    /*
                       Get total YouTube likes.

                       This becomes the baseline.

                       Example:

                       Existing likes = 250

                       Baseline = 250

                       Overlay starts:

                       0 / 5
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

                        likes: 0,

                        updatedAt:
                            Date.now()

                    };


                    console.log(
                        "Like baseline:",
                        likeBaseline
                    );


                    return;

                }


                /* =========================================
                   5. EXISTING ACTIVE STREAM
                   ========================================= */

                /*
                   Safety check.
                */

                if (
                    likeBaseline === null
                ) {

                    const startingLikes =
                        await fetchVideoLikes(
                            activeVideoId
                        );


                    likeBaseline =
                        startingLikes;


                    likeCache = {

                        likes: 0,

                        updatedAt:
                            Date.now()

                    };


                    return;

                }


                /*
                   Get current total likes.
                */

                const currentLikes =
                    await fetchVideoLikes(
                        activeVideoId
                    );


                /*
                   Calculate likes gained
                   during this stream.
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


                console.log(
                    "Stream likes:",
                    streamLikes
                );


            } catch (error) {

                console.error(
                    "YouTube refresh error:",
                    error
                );

            } finally {

                refreshPromise =
                    null;

            }

        })();


    return refreshPromise;

}


/* =========================================================
   SUBSCRIBER API
   ========================================================= */

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

            /*
               Refresh YouTube data if the cache
               is older than 30 seconds.
            */

            if (
                Date.now() -
                subscriberCache.updatedAt
                >=
                YOUTUBE_CACHE_TIME
            ) {

                await refreshYouTubeData();

            }


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
                    new Date()
                        .toISOString()

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

            /*
               Refresh YouTube data if the cache
               is older than 30 seconds.
            */

            if (
                Date.now() -
                likeCache.updatedAt
                >=
                YOUTUBE_CACHE_TIME
            ) {

                await refreshYouTubeData();

            }


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
                    new Date()
                        .toISOString()

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
            "================================="
        );

    }
);