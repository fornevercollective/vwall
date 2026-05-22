#!/bin/bash
# Trust the self-signed certificate on macOS
# Run this with sudo: sudo ./trust_cert.sh

CERT_PATH="$(pwd)/cert.pem"
echo "Adding certificate to System Keychain..."
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_PATH"
if [ $? -eq 0 ]; then
    echo "Certificate trusted. Restart your browser and visit https://127.0.0.1:5000/"
else
    echo "Failed to trust certificate."
fi