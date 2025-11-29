# freestyle_client.CertsApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_verify_wildcard**](CertsApi.md#handle_verify_wildcard) | **POST** /domains/v1/certs/{domain}/wildcard | Provision a wildcard certificate


# **handle_verify_wildcard**
> HandleVerifyWildcard200Response handle_verify_wildcard(domain)

Provision a wildcard certificate

Provisions a wildcard certificate for a verified domain


This speeds up deploys on all subdomains of the domain. In order to use it, you must add the following record to your DNS config:

`_acme-challenge.yourdomain.com` NS `dns.freestyle.sh`

### Example


```python
import freestyle_client
from freestyle_client.models.handle_verify_wildcard200_response import HandleVerifyWildcard200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.CertsApi(api_client)
    domain = 'domain_example' # str | 

    try:
        # Provision a wildcard certificate
        api_response = api_instance.handle_verify_wildcard(domain)
        print("The response of CertsApi->handle_verify_wildcard:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CertsApi->handle_verify_wildcard: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **domain** | **str**|  | 

### Return type

[**HandleVerifyWildcard200Response**](HandleVerifyWildcard200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Domain verified |  -  |
**400** | Failed to preverify domain |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

