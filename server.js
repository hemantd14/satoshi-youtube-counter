const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;


/* =========================================================
   YOUTUBE CONFIGURATION
   ========================================================= */

const YOUTUBE_API_KEY =
    process.env.YOUTUBE_API_KEY;

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
   When a new stream is detected, the current YouTube
   like count becomes the starting baseline.

   Example:

   YouTube video currently has 127 likes
   Stream starts/detected
   Baseline = 127

   Later YouTube has 132 likes

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
   YOUTUBE CACHE TIME
   ========================================================= */

/*
   OBS can request the server every second.

   The server itself only contacts YouTube every
   30 seconds.

   This prevents unnecessary YouTube API requests.
*/

const YOUTUBE_CACHE_TIME = 30000;


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
        refresh_token: YOUTUBE_REFRESH_TOKEN
    });

    return oauth2Client;
}


/* =========================================================
   SUBSCRIBER GOAL
   ========================================================= */

/*
   Examples:

   0   -> 50
   49  -> 50
   50  -> 100
   84  -> 100
   99  -> 100
   100 -> 150
   149 -> 150
   150 -> 200
*/

function calculateSubscriberGoal(subscribers) {

    return (
        Math.floor(subscribers / 50) + 1
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

function calculateLikeGoal(likes) {

    return (
        Math.floor(likes / 5) + 1
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
   Uses OAuth to ask YouTube:

   "Is MY channel currently live?"

   broadcastStatus = active
   mine = true

   This means we no longer need:

   YOUTUBE_VIDEO_ID

   The authenticated YouTube account determines
   the active broadcast automatically.
*/

async function findActiveBroadcast() {

    const client =
        getAuthenticatedClient();


    if (!client) {

        throw new Error(
            "YouTube OAuth is not configured"
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
                5

        });


    const items =
        response.data.items || [];


    /*
       No active livestream
    */

    if (
        items.length === 0
    ) {

        return null;

    }


    /*
       Get the first active broadcast
    */

    const broadcast =
        items[0];


    return {

        id:
            broadcast.id,

        title:
            broadcast.snippet?.title || ""

    };

}


/* =========================================================
   FETCH SUBSCRIBERS
   ========================================================= */

async function fetchSubscribers() {

    const url =
        "https://www.googleapis.com/youtube/v3/channels" +

        "?part=statistics" +

        "&id=" +
        encodeURIComponent(
            YOUTUBE_CHANNEL_ID
        ) +

        "&key=" +
        encodeURIComponent(
            YOUTUBE_API_KEY
        );


    const response =
        await fetch(url);


    const data =
        await response.json();


    if (!response.ok) {

        console.error(
            "YouTube subscriber API response:",
            data
        );

        throw new Error(
            "YouTube subscriber API failed"
        );

    }


    if (
        !data.items ||
        data.items.length === 0
    ) {

        throw new Error(
            "YouTube channel not found"
        );

    }


    return Number(
        data.items[0]
            .statistics
            .subscriberCount
    );

}


/* =========================================================
   FETCH VIDEO LIKES
   ========================================================= */

async function fetchVideoLikes(
    videoId
) {

    const url =
        "https://www.googleapis.com/youtube/v3/videos" +

        "?part=statistics" +

        "&id=" +
        encodeURIComponent(
            videoId
        ) +

        "&key=" +
        encodeURIComponent(
            YOUTUBE_API_KEY
        );


    const response =
        await fetch(url);


    const data =
        await response.json();


    if (!response.ok) {

        console.error(
            "YouTube video API response:",
            data
        );

        throw new Error(
            "YouTube video API failed"
        );

    }


    if (
        !data.items ||
        data.items.length === 0
    ) {

        throw new Error(
            "Live video not found"
        );

    }


    return Number(
        data.items[0]
            .statistics
            .likeCount || 0
    );

}


/* =========================================================
   REFRESH ALL YOUTUBE DATA
   ========================================================= */

async function refreshYouTubeData() {

    try {

        /* =================================================
           1. SUBSCRIBERS
           ================================================= */

        const subscribers =
            await fetchSubscribers();


        subscriberCache = {

            subscribers:
                subscribers,

            updatedAt:
                Date.now()

        };


        /* =================================================
           2. FIND ACTIVE STREAM
           ================================================= */

        const broadcast =
            await findActiveBroadcast();


        /* =================================================
           3. NO ACTIVE STREAM
           ================================================= */

        if (!broadcast) {

            /*
               Nobody is currently live.

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

            return;

        }


        /* =================================================
           4. NEW STREAM DETECTED
           ================================================= */

        if (
            activeVideoId !==
            broadcast.id
        ) {

            console.log(
                "New YouTube stream detected:",
                broadcast.id
            );


            /*
               Save the new video ID.
            */

            activeVideoId =
                broadcast.id;


            /*
               Get the current total likes.

               These become the baseline for
               this stream.
            */

            const startingLikes =
                await fetchVideoLikes(
                    activeVideoId
                );


            likeBaseline =
                startingLikes;


            /*
               A new stream always starts at:

               0 / 5
            */

            likeCache = {

                likes: 0,

                updatedAt:
                    Date.now()

            };


            console.log(
                "Stream like baseline:",
                likeBaseline
            );


            return;

        }


        /* =================================================
           5. EXISTING ACTIVE STREAM
           ================================================= */

        const currentLikes =
            await fetchVideoLikes(
                activeVideoId
            );


        /*
           Calculate likes gained during
           this stream.

           Example:

           Baseline = 100
           Current  = 107

           Stream likes = 7
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


    } catch (error) {

        console.error(
            "YouTube refresh error:",
            error
        );

    }

}


/* =========================================================
   SUBSCRIBER API
   ========================================================= */

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

            /*
               Only contact YouTube when
               the cache is older than 30 seconds.
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
               Refresh YouTube data when
               the cache is older than 30 seconds.
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
            `Server running on port ${PORT}`
        );

    }
);