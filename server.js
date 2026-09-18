const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;


// ========================================
// YOUTUBE CONFIGURATION
// ========================================

const YOUTUBE_API_KEY =
    process.env.YOUTUBE_API_KEY;

const YOUTUBE_CHANNEL_ID =
    process.env.YOUTUBE_CHANNEL_ID;


// ========================================
// RAZORPAY CONFIGURATION - DISABLED
// ========================================

/*
const RAZORPAY_KEY_ID =
    process.env.RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
    process.env.RAZORPAY_KEY_SECRET;

const RAZORPAY_PAYMENT_LINK_ID =
    process.env.RAZORPAY_PAYMENT_LINK_ID;
*/


// ========================================
// HOME
// ========================================

app.get("/", (req, res) => {

    res.json({

        status: "online",

        service:
            "Satoshi's Franchise YouTube Counter",

        features: [
            "YouTube subscriber counter"

            // "Razorpay support counter"
        ]

    });

});


// ========================================
// OBS OVERLAY
// ========================================

app.get("/overlay", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "Sub counter.html"
        )
    );

});


// ========================================
// YOUTUBE SUBSCRIBER API
// ========================================

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

            if (
                !YOUTUBE_API_KEY ||
                !YOUTUBE_CHANNEL_ID
            ) {

                return res.status(500).json({

                    error:
                        "YouTube server configuration missing"

                });

            }


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
                    "YouTube API error:",
                    data
                );

                return res.status(500).json({

                    error:
                        "YouTube API request failed"

                });

            }


            if (
                !data.items ||
                data.items.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "Channel not found"

                });

            }


            const statistics =
                data.items[0].statistics;


            res.json({

                subscribers:
                    Number(
                        statistics.subscriberCount
                    ),

                hidden:
                    statistics.hiddenSubscriberCount ||
                    false,

                updatedAt:
                    new Date().toISOString()

            });


        } catch (error) {

            console.error(
                "YouTube server error:",
                error
            );


            res.status(500).json({

                error:
                    "Internal server error"

            });

        }

    }
);


// ========================================
// RAZORPAY SUPPORT TOTAL - DISABLED
// ========================================

/*

app.get(
    "/api/razorpay/total",
    async (req, res) => {

        try {

            // --------------------------------
            // Check configuration
            // --------------------------------

            if (
                !RAZORPAY_KEY_ID ||
                !RAZORPAY_KEY_SECRET ||
                !RAZORPAY_PAYMENT_LINK_ID
            ) {

                console.error(
                    "Razorpay environment variables missing"
                );


                return res.status(500).json({

                    error:
                        "Razorpay server configuration missing"

                });

            }


            // --------------------------------
            // Razorpay Payment Link API
            // --------------------------------

            const url =
                "https://api.razorpay.com/v1/payment_links/" +
                encodeURIComponent(
                    RAZORPAY_PAYMENT_LINK_ID
                );


            // --------------------------------
            // Basic Authentication
            // --------------------------------

            const auth =
                Buffer
                    .from(
                        RAZORPAY_KEY_ID +
                        ":" +
                        RAZORPAY_KEY_SECRET
                    )
                    .toString("base64");


            const response =
                await fetch(
                    url,
                    {

                        method: "GET",

                        headers: {

                            "Authorization":
                                "Basic " + auth,

                            "Content-Type":
                                "application/json"

                        },

                        cache: "no-store"

                    }
                );


            const data =
                await response.json();


            // --------------------------------
            // Razorpay API error
            // --------------------------------

            if (!response.ok) {

                console.error(
                    "Razorpay API error:",
                    data
                );


                return res.status(500).json({

                    error:
                        "Razorpay API request failed"

                });

            }


            // --------------------------------
            // amount_paid is in paise
            // --------------------------------

            const amountPaidPaise =
                Number(
                    data.amount_paid || 0
                );


            const total =
                amountPaidPaise / 100;


            // --------------------------------
            // Send only safe information
            // to OBS
            // --------------------------------

            res.json({

                total: total,

                currency:
                    data.currency || "INR",

                paymentLinkId:
                    data.id,

                status:
                    data.status,

                updatedAt:
                    new Date().toISOString()

            });


        } catch (error) {

            console.error(
                "Razorpay server error:",
                error
            );


            res.status(500).json({

                error:
                    "Internal Razorpay server error"

            });

        }

    }
);

*/


// ========================================
// START SERVER
// ========================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);