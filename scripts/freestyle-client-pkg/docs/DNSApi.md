# freestyle_client.DNSApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_create_record**](DNSApi.md#handle_create_record) | **POST** /dns/v1/records | Create DNS Record
[**handle_delete_record**](DNSApi.md#handle_delete_record) | **DELETE** /dns/v1/records | Delete DNS Record
[**handle_list_records**](DNSApi.md#handle_list_records) | **GET** /dns/v1/records | List DNS Records


# **handle_create_record**
> CreateRecordResponse handle_create_record(create_record_params)

Create DNS Record

### Example


```python
import freestyle_client
from freestyle_client.models.create_record_params import CreateRecordParams
from freestyle_client.models.create_record_response import CreateRecordResponse
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
    api_instance = freestyle_client.DNSApi(api_client)
    create_record_params = freestyle_client.CreateRecordParams() # CreateRecordParams | 

    try:
        # Create DNS Record
        api_response = api_instance.handle_create_record(create_record_params)
        print("The response of DNSApi->handle_create_record:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DNSApi->handle_create_record: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_record_params** | [**CreateRecordParams**](CreateRecordParams.md)|  | 

### Return type

[**CreateRecordResponse**](CreateRecordResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**403** | Possible errors: DomainOwnershipError, RecordOwnershipError, DomainOwnershipVerificationFailed |  -  |
**500** | Possible errors: ErrorCreatingRecord, ErrorDeletingRecord |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_record**
> DeleteRecordResponse handle_delete_record(domain, record)

Delete DNS Record

### Example


```python
import freestyle_client
from freestyle_client.models.delete_record_response import DeleteRecordResponse
from freestyle_client.models.dns_record import DnsRecord
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
    api_instance = freestyle_client.DNSApi(api_client)
    domain = 'example.com' # str | 
    record = freestyle_client.DnsRecord() # DnsRecord | 

    try:
        # Delete DNS Record
        api_response = api_instance.handle_delete_record(domain, record)
        print("The response of DNSApi->handle_delete_record:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DNSApi->handle_delete_record: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **domain** | **str**|  | 
 **record** | [**DnsRecord**](.md)|  | 

### Return type

[**DeleteRecordResponse**](DeleteRecordResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**403** | Possible errors: DomainOwnershipError, RecordOwnershipError, DomainOwnershipVerificationFailed |  -  |
**500** | Possible errors: ErrorCreatingRecord, ErrorDeletingRecord |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_records**
> ListRecordsResponse handle_list_records(domain)

List DNS Records

### Example


```python
import freestyle_client
from freestyle_client.models.list_records_response import ListRecordsResponse
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
    api_instance = freestyle_client.DNSApi(api_client)
    domain = 'example.com' # str | 

    try:
        # List DNS Records
        api_response = api_instance.handle_list_records(domain)
        print("The response of DNSApi->handle_list_records:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DNSApi->handle_list_records: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **domain** | **str**|  | 

### Return type

[**ListRecordsResponse**](ListRecordsResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**400** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

