const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

const PORT =
    process.env.PORT || 10000;


/* ========================================
   YOUTUBE CONFIGURATION
   ======================================== */

const YOUTUBE_API_KEY =
    process.env.YOUTUBE_API_KEY;

const YOUTUBE_CHANNEL_ID =
    process.env.YOUTUBE_CHANNEL_ID;


/* ========================================
   GOOGLE OAUTH CONFIGURATION
   ======================================== */

const GOOGLE_CLIENT_ID =
    process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET;

const YOUTUBE_REFRESH_TOKEN =
    process.env.YOUTUBE_REFRESH_TOKEN;


/* ========================================
   OAUTH REDIRECT URL
   ======================================== */

const GOOGLE_REDIRECT_URI =
    process.env.GOOGLE_REDIRECT_URI ||
    "https://satoshi-youtube-counter.onrender.com/oauth2callback";


/* ========================================
   RAZORPAY - DISABLED
   ======================================== */

/*

const RAZORPAY_KEY_ID =
    process.env.RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
    process.env.RAZORPAY_KEY_SECRET;

const RAZORPAY_PAYMENT_LINK_ID =
    process.env.RAZORPAY_PAYMENT_LINK_ID;

*/


/* ========================================
   GOOGLE OAUTH CLIENT
   ======================================== */

const oauth2Client =
    new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
    );


/* ========================================
   YOUTUBE READ-ONLY SCOPE
   ======================================== */

const YOUTUBE_SCOPE =
    "https://www.googleapis.com/auth/youtube.readonly";


/* ========================================
   OAUTH STATE
   ======================================== */

let oauthState = null;


/* ========================================
   ACTIVE VIDEO
   ======================================== */

let activeVideoId = null;

let activeVideoTitle = null;


/* ========================================
   LIKE BASELINE
   ======================================== */

let likeBaseline = null;


/* ========================================
   CACHE
   ======================================== */

let subscriberCache = {

    subscribers: 0,

    updatedAt: 0

};


let likeCache = {

    likes: 0,

    updatedAt: 0

};


/* ========================================
   CACHE TIME
   ======================================== */

const YOUTUBE_CACHE_TIME =
    30000;


/* ========================================
   AUTHENTICATION
   ======================================== */

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


/* ========================================
   SUBSCRIBER GOAL
   ======================================== */

function calculateSubscriberGoal(
    subscribers
) {

    return (
        Math.floor(
            subscribers / 50
        ) + 1
    ) * 50;

}


/* ========================================
   LIKE GOAL
   ======================================== */

function calculateLikeGoal(
    likes
) {

    return (
        Math.floor(
            likes / 5
        ) + 1
    ) * 5;

}


/* ========================================
   HOME
   ======================================== */

app.get(
    "/",
    (req, res) => {

        res.json({

            status:
                "online",

            service:
                "Satoshi's Franchise Stream Counter",

            features: [

                "YouTube subscribers",

                "Automatic active stream detection",

                "Stream likes",

                "Dynamic goals"

            ]

        });

    }
);


/* ========================================
   OBS OVERLAY
   ======================================== */

app.get(
    "/overlay",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "Sub counter.html"
            )
        );

    }
);


/* ========================================
   START OAUTH
   ======================================== */

app.get(
    "/auth/youtube",
    (req, res) => {

        if (
            !GOOGLE_CLIENT_ID ||
            !GOOGLE_CLIENT_SECRET
        ) {

            return res.status(500).send(
                "Google OAuth configuration missing."
            );

        }


        oauthState =
            crypto
                .randomBytes(32)
                .toString("hex");


        const authUrl =
            oauth2Client.generateAuthUrl({

                access_type:
                    "offline",

                scope: [
                    YOUTUBE_SCOPE
                ],

                include_granted_scopes:
                    true,

                prompt:
                    "consent",

                state:
                    oauthState

            });


        res.redirect(
            authUrl
        );

    }
);


/* ========================================
   OAUTH CALLBACK
   ======================================== */

app.get(
    "/oauth2callback",
    async (req, res) => {

        try {

            const code =
                req.query.code;

            const state =
                req.query.state;


            if (
                !code ||
                !state ||
                state !== oauthState
            ) {

                return res.status(400).send(
                    "Invalid OAuth state."
                );

            }


            oauthState =
                null;


            const {
                tokens
            } =
                await oauth2Client.getToken(
                    code
                );


            if (
                !tokens.refresh_token
            ) {

                return res.status(400).send(
                    "No refresh token was returned. Re-authorize with consent."
                );

            }


            /*
               IMPORTANT:

               The refresh token is displayed ONCE
               so you can copy it into Render.

               Do NOT share it with anyone.
            */

            res.send(`

                <html>

                <body
                    style="
                    font-family:Arial;
                    max-width:800px;
                    margin:50px auto;
                    "
                >

                <h2>
                    YouTube authorization successful
                </h2>

                <p>
                    Copy the refresh token below
                    into your Render environment
                    variable:
                </p>

                <p>
                    <strong>
                    YOUTUBE_REFRESH_TOKEN
                    </strong>
                </p>

                <textarea
                    style="
                    width:100%;
                    height:120px;
                    "
                    readonly
                >${tokens.refresh_token}</textarea>

                <p>
                    After adding it to Render,
                    redeploy the service.
                </p>

                <p>
                    You may then remove this
                    OAuth setup route if desired.
                </p>

                </body>

                </html>

            `);


        } catch (error) {

            console.error(
                "OAuth callback error:",
                error
            );


            res.status(500).send(
                "OAuth authorization failed."
            );

        }

    }
);


/* ========================================
   FIND ACTIVE BROADCAST
   ======================================== */

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

            version:
                "v3",

            auth:
                client

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


    if (
        items.length === 0
    ) {

        return null;

    }


    const broadcast =
        items[0];


    return {

        id:
            broadcast.id,

        title:
            broadcast.snippet
                ?.title || ""

    };

}


/* ========================================
   FETCH SUBSCRIBERS
   ======================================== */

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


/* ========================================
   FETCH VIDEO LIKES
   ======================================== */

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


/* ========================================
   REFRESH YOUTUBE DATA
   ======================================== */

async function refreshYouTubeData() {

    try {

        /* -------------------------------
           SUBSCRIBERS
           ------------------------------- */

        const subscribers =
            await fetchSubscribers();


        subscriberCache = {

            subscribers:
                subscribers,

            updatedAt:
                Date.now()

        };


        /* -------------------------------
           ACTIVE BROADCAST
           ------------------------------- */

        const broadcast =
            await findActiveBroadcast();


        if (!broadcast) {

            /*
               No active stream.
            */

            activeVideoId =
                null;

            activeVideoTitle =
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


        /* -------------------------------
           NEW STREAM DETECTION
           ------------------------------- */

        if (
            activeVideoId !==
            broadcast.id
        ) {

            console.log(
                "New YouTube stream detected:",
                broadcast.id
            );


            activeVideoId =
                broadcast.id;


            activeVideoTitle =
                broadcast.title;


            /*
               Get the current like count
               and use it as the starting
               baseline for this stream.
            */

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


        /* -------------------------------
           EXISTING STREAM
           ------------------------------- */

        const currentLikes =
            await fetchVideoLikes(
                activeVideoId
            );


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


/* ========================================
   SUBSCRIBER ENDPOINT
   ======================================== */

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

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


            res.json({

                subscribers:
                    subscribers,

                subscriberGoal:
                    calculateSubscriberGoal(
                        subscribers
                    ),

                updatedAt:
                    new Date()
                        .toISOString()

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                error:
                    "Unable to get subscribers"

            });

        }

    }
);


/* ========================================
   LIKE ENDPOINT
   ======================================== */

app.get(
    "/api/youtube/likes",
    async (req, res) => {

        try {

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


            res.json({

                likes:
                    likes,

                likeGoal:
                    calculateLikeGoal(
                        likes
                    ),

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

            console.error(error);


            res.status(500).json({

                error:
                    "Unable to get likes"

            });

        }

    }
);


/* ========================================
   RAZORPAY - DISABLED
   ======================================== */

/*

app.get(
    "/api/razorpay/total",
    async (req, res) => {

        // Disabled for now.

    }
);

*/


/* ========================================
   START SERVER
   ======================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);